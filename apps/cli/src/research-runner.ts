import { performance } from "node:perf_hooks";
import {
  buildResearchAnswerPrompt,
  createTaskPhaseController,
  createToolApprovalHandler,
  prependContinuationBrief,
  runOpenHarnessRuntime,
  type OpenHarnessRuntimeDeps,
} from "@xeq/agent-core";
import { AgentRequestSchema } from "@xeq/shared";
import { appendMessage, loadLatestCompactContinuationArtifact, updateSessionTitle } from "@xeq/storage";
import { createSandboxEnvironment } from "@xeq/sandbox";
import { createWebSearchProvider } from "@xeq/web";
import { resolveActiveWebProvider } from "./auth-store.js";
import { requestApproval, withApprovalQueue } from "./approvals.js";
import { webFetchRuleForUrl } from "./settings-store.js";
import type { SessionState } from "./session-state.js";
import type { Tui } from "@xeq/tui";
import { createTurnStateMachine } from "./turn-state-machine.js";
import { titleFromTask } from "./task-title.js";
import { pruneSessionAfterTurn } from "./recovery/prune.js";
import type { TurnContext, TurnResult } from "./turn-types.js";

type PatchPreview = NonNullable<OpenHarnessRuntimeDeps["approvePatchApply"]> extends (
  preview: infer T,
) => unknown
  ? T
  : never;

function newMessageId(sessionId: string, role: string): string {
  return `${sessionId}_${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

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

export async function runResearchTask(
  task: string,
  intent: Extract<TurnContext["intent"], "question" | "research">,
  tui: Tui,
  state: SessionState,
  abortController?: AbortController,
): Promise<TurnResult> {
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
  const continuationArtifact = await loadLatestCompactContinuationArtifact(state.sessionId);
  const turnContext: TurnContext = {
    sessionId: state.sessionId,
    task: request.task,
    intent,
    projectRoot: state.projectRoot,
    approvalMode: state.approvalMode,
    modelId: state.modelId,
    startedAt: started,
  };
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
      message: `${frame} Researching current state...`,
      options: ["esc=abort"],
    });
  }, 120);

  const patchApprovedPaths = new Set<string>();
  const phase = createTaskPhaseController();
  const turn = createTurnStateMachine(intent);
  turn.transition("routing");

  const env = createSandboxEnvironment({
    cwd: request.repoRoot,
    approvals: async (approvalRequest) => {
      promptPending = true;
      try {
        return await requestApproval(tui, approvalRequest, state.sessionId);
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
          const approval = await requestApproval(
            tui,
            {
              kind: "web-fetch",
              target: rule,
            },
            state.sessionId,
          );
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
      return await requestApproval(tui, approvalRequest, state.sessionId);
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

  const approvePatchApply = async (_preview: PatchPreview) => {
    promptPending = true;
    try {
      await withApprovalQueue(() =>
        tui.promptApproval({
          message: "Edits are disabled in research mode",
          details: "Questions and research requests should remain read-only.",
          choices: [
            {
              value: "reject",
              label: "Reject",
              description: "Keep research mode read-only",
            },
          ],
        }),
      );
      return false;
    } finally {
      promptPending = false;
    }
  };

  try {
    turn.beginResearch();
    const prompt = prependContinuationBrief(
      buildResearchAnswerPrompt(request.task, intent),
      continuationArtifact,
    );
    const researchResult = await runOpenHarnessRuntime(
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
            return;
          }

          tui.renderStep({
            step: step.step,
            action: step.action,
            thought: step.thought,
            observation: step.observation,
          });
        },
        onTextDelta: (delta) => tui.renderAssistantDelta(delta),
      },
      prompt,
      {
        cwd: request.repoRoot,
        maxSteps: Math.min(48, Math.max(12, Math.floor(request.maxSteps / 3))),
        timeoutMs: request.maxDurationMs,
        abortSignal: activeAbortController.signal,
      },
    );

    if (researchResult.status === "cancelled") {
      turn.cancel();
    } else if (researchResult.status === "completed") {
      turn.finish();
    } else {
      turn.fail();
    }

    tui.renderSummary({
      success: turn.state === "done",
      steps: researchResult.steps,
      durationMs: Math.round(performance.now() - started),
      promptTokens: researchResult.usage?.promptTokens ?? 0,
      completionTokens: researchResult.usage?.completionTokens ?? 0,
      estimatedCostUsd: researchResult.estimatedCostUsd ?? 0,
    });
    void pruneSessionAfterTurn(state.sessionId);
    return {
      status:
        turn.state === "done" ? "completed" : turn.state === "cancelled" ? "cancelled" : "failed",
      intent: turnContext.intent,
      task: turnContext.task,
      summary: {
        success: turn.state === "done",
        steps: researchResult.steps,
        durationMs: Math.round(performance.now() - started),
        promptTokens: researchResult.usage?.promptTokens ?? 0,
        completionTokens: researchResult.usage?.completionTokens ?? 0,
        estimatedCostUsd: researchResult.estimatedCostUsd ?? 0,
      },
    };
  } finally {
    clearInterval(spinner);
    tui.onCancelRunning(null);
    tui.renderApprovalPrompt(null);
  }
}
