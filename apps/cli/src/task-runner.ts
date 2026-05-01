import { performance } from "node:perf_hooks";
import {
  buildContextGatheringPrompt,
  buildImplementationPrompt,
  createTaskPhaseController,
  createToolApprovalHandler,
  type OpenHarnessRuntimeDeps,
  runOpenHarnessRuntime,
} from "@xeq/agent-core";
import { createSandboxEnvironment } from "@xeq/sandbox";
import { AgentRequestSchema } from "@xeq/shared";
import { appendMessage, updateSessionTitle } from "@xeq/storage";
import { createWebSearchProvider } from "@xeq/web";
import { requestApproval, withApprovalQueue } from "./approvals.js";
import { webFetchRuleForUrl } from "./settings-store.js";
import type { SessionState } from "./session-state.js";
import type { Tui } from "@xeq/tui";
import { resolveActiveWebProvider } from "./auth-store.js";

export function titleFromTask(task: string): string {
  return task.replace(/\s+/g, " ").trim().slice(0, 80);
}

function newMessageId(sessionId: string, role: string): string {
  return `${sessionId}_${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function mergeUsage(
  left:
    | {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      }
    | undefined,
  right:
    | {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      }
    | undefined,
) {
  return {
    promptTokens: (left?.promptTokens ?? 0) + (right?.promptTokens ?? 0),
    completionTokens: (left?.completionTokens ?? 0) + (right?.completionTokens ?? 0),
    totalTokens: (left?.totalTokens ?? 0) + (right?.totalTokens ?? 0),
  };
}

type PatchPreview = NonNullable<OpenHarnessRuntimeDeps["approvePatchApply"]> extends (
  preview: infer T,
) => unknown
  ? T
  : never;

function updateWebSessionState(
  state: SessionState,
  resolved: Awaited<ReturnType<typeof resolveActiveWebProvider>>,
): void {
  if (!resolved) {
    state.webProvider = null;
    state.webAuthSource = null;
    return;
  }

  state.webProvider = resolved.provider;
  state.webAuthSource = resolved.authSource;
}

async function ensureWebProviderConnected(tui: Tui, state: SessionState): Promise<boolean> {
  const resolved = await resolveActiveWebProvider();
  updateWebSessionState(state, resolved);
  if (resolved) {
    return true;
  }

  tui.renderApprovalPrompt({
    message: "Web search is not connected.",
    options: ["wait"],
  });
  return false;
}

export async function runTask(
  task: string,
  tui: Tui,
  state: SessionState,
  abortController?: AbortController,
): Promise<void> {
  const activeAbortController = abortController ?? new AbortController();
  const request = AgentRequestSchema.parse({
    task,
    repoRoot: state.projectRoot,
    approvalMode: state.approvalMode,
    maxSteps: 256,
    maxDurationMs: 120000,
  });

  if (!state.sessionTitle) {
    state.sessionTitle = titleFromTask(request.task);
    await updateSessionTitle({
      id: state.sessionId,
      title: state.sessionTitle,
    });
  }

  tui.renderApprovalPrompt({ message: request.task, options: ["running"] });

  const started = performance.now();
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;
  let promptPending = false;
  const spinner = setInterval(() => {
    if (promptPending) {
      return;
    }

    const frame = spinnerFrames[frameIndex % spinnerFrames.length];
    frameIndex += 1;
    tui.renderApprovalPrompt({
      message: `${frame} Processing task...`,
      options: ["esc=abort"],
    });
  }, 120);

  const patchApprovedPaths = new Set<string>();
  const phase = createTaskPhaseController();

  const env = createSandboxEnvironment({
    cwd: request.repoRoot,
    approvals: async (approvalRequest) => {
      if (approvalRequest.kind === "file-write" && patchApprovedPaths.has(approvalRequest.target)) {
        patchApprovedPaths.delete(approvalRequest.target);
        return "once";
      }
      promptPending = true;
      try {
        return await requestApproval(tui, approvalRequest);
      } finally {
        promptPending = false;
      }
    },
  });

  tui.renderUserMessage(request.task);
  await appendMessage({
    id: newMessageId(state.sessionId, "user"),
    session_id: state.sessionId,
    role: "user",
    kind: "transcript",
    content: request.task,
  });

  const webSearch = createWebSearchProvider(
    async () => {
      promptPending = true;
      try {
        const connected = await ensureWebProviderConnected(tui, state);
        if (!connected) {
          throw new Error("Web search cancelled: no provider configured");
        }

        const resolved = await resolveActiveWebProvider();
        updateWebSessionState(state, resolved);
        if (!resolved) {
          throw new Error("Web search is unavailable");
        }

        return {
          provider: resolved.provider,
          apiKey: resolved.apiKey,
        };
      } finally {
        promptPending = false;
      }
    },
    {
      allowUrl: async (url) => {
        const rule = webFetchRuleForUrl(url);
        if (!rule) {
          throw new Error(`Invalid URL for web fetch: ${url}`);
        }

        promptPending = true;
        try {
          const approval = await requestApproval(tui, {
            kind: "web-fetch",
            target: rule,
          });
          if (approval === "reject") {
            throw new Error(`Web fetch denied for ${rule}`);
          }
        } finally {
          promptPending = false;
        }
      },
    },
  );

  const requestApprovalForTool = async (approvalRequest: Parameters<typeof requestApproval>[1]) => {
    promptPending = true;
    try {
      return await requestApproval(tui, approvalRequest);
    } finally {
      promptPending = false;
    }
  };

  const approveToolCall = createToolApprovalHandler({
    approvalMode: state.approvalMode,
    phase,
    patchApprovedPaths,
    requestApproval: requestApprovalForTool,
  });

  const approvePatchApply = async (preview: PatchPreview) => {
    if (phase.isContextPhase()) {
      return false;
    }

    if (state.approvalMode === "auto-edit") {
      if (preview.files) {
        for (const f of preview.files) {
          patchApprovedPaths.add(f.filePath);
        }
      } else if (preview.filePath) {
        patchApprovedPaths.add(preview.filePath);
      }
      return true;
    }

    promptPending = true;
    try {
      const approval = await withApprovalQueue(() =>
        tui.promptApproval({
          message: "Review changes",
          details: preview.summary ? preview.summary : "Inspect the patch before applying.",
          review:
            preview.files && preview.files.length > 0
              ? {
                  summary: preview.summary ?? "Prepared changes",
                  changedFilesCount: preview.changedFilesCount ?? preview.files.length,
                  files: preview.files,
                }
              : undefined,
          choices: [
            {
              value: "reject",
              label: "Reject",
              description: "Deny these changes",
            },
            {
              value: "once",
              label: "Approve once",
              description: "Apply these changes this time only",
            },
            {
              value: "always",
              label: "Always approve",
              description: "Remember this approval choice",
            },
          ],
        }),
      );
      if (approval !== "reject" && preview.files) {
        for (const f of preview.files) {
          patchApprovedPaths.add(f.filePath);
        }
      }
      return approval !== "reject";
    } finally {
      promptPending = false;
    }
  };

  const runPhase = async (prompt: string, persistTranscript: boolean) =>
    runOpenHarnessRuntime(
      {
        modelId: state.modelId,
        sessionId: state.sessionId,
        providers: {
          ...env,
          webSearch,
        },
        approveToolCall,
        approvePatchApply,
        onStep: (step) => {
          if (step.action === "model.final") {
            if (persistTranscript) {
              tui.finalizeAssistantStream(step.observation);
              if (step.observation?.trim()) {
                void appendMessage({
                  id: newMessageId(state.sessionId, "assistant"),
                  session_id: state.sessionId,
                  role: "assistant",
                  kind: "transcript",
                  content: step.observation,
                });
              }
            }
            return;
          }

          tui.renderStep({
            step: step.step,
            action: step.action,
            thought: step.thought,
            observation: step.observation,
          });
        },
        onTextDelta: persistTranscript ? (delta) => tui.renderAssistantDelta(delta) : undefined,
      },
      prompt,
      {
        cwd: request.repoRoot,
        maxSteps: request.maxSteps,
        timeoutMs: request.maxDurationMs,
        abortSignal: activeAbortController.signal,
      },
    );

  try {
    const contextResult = await runPhase(buildContextGatheringPrompt(request.task), false);
    if (contextResult.status !== "completed") {
      tui.renderSummary({
        success: contextResult.status === "cancelled",
        steps: contextResult.steps,
        durationMs: Math.round(performance.now() - started),
        promptTokens: contextResult.usage?.promptTokens ?? 0,
        completionTokens: contextResult.usage?.completionTokens ?? 0,
        estimatedCostUsd: contextResult.estimatedCostUsd ?? 0,
      });
      return;
    }

    tui.renderApprovalPrompt({
      message: "Context gathered. Starting implementation...",
      options: ["running"],
    });
    phase.beginImplementation();
    const implementationResult = await runPhase(buildImplementationPrompt(request.task), true);

    const usage = mergeUsage(contextResult.usage, implementationResult.usage);
    tui.renderSummary({
      success:
        implementationResult.status === "completed" ||
        implementationResult.status === "cancelled",
      steps: implementationResult.steps,
      durationMs: Math.round(performance.now() - started),
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      estimatedCostUsd:
        (contextResult.estimatedCostUsd ?? 0) + (implementationResult.estimatedCostUsd ?? 0),
    });
  } finally {
    clearInterval(spinner);
    tui.onCancelRunning(null);
    tui.renderApprovalPrompt(null);
  }
}
