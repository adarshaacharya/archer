import { performance } from "node:perf_hooks";
import {
  buildContextGatheringPrompt,
  buildPlanningPrompt,
  buildImplementationPrompt,
  buildVerificationPrompt,
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

function isContextBudgetResult(
  result: { status: string; error?: string } | null | undefined,
): boolean {
  if (!result || result.status !== "failed" || !result.error) {
    return false;
  }

  return (
    result.error.startsWith("Run exceeded maxSteps=") ||
    result.error === "Run cancelled" ||
    result.error.toLowerCase().includes("timeout")
  );
}

function expandedContextSteps(maxSteps: number, initialContextSteps: number): number {
  const cap = Math.min(64, Math.max(24, Math.floor(maxSteps / 3)));
  return Math.max(initialContextSteps + 8, cap);
}

type ExecutionPlan = {
  goal: string;
  steps: Array<{
    id: string;
    title: string;
    targets: string[];
    rationale: string;
    verification: string;
  }>;
};

type VerificationReport = {
  passed: boolean;
  commands: string[];
  findings: string[];
};

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const directStart = trimmed.indexOf("{");
  if (directStart === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let i = directStart; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return trimmed.slice(start, i + 1);
      }
    }
  }

  return null;
}

function parseVerificationReport(raw: string): VerificationReport | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as {
      passed?: unknown;
      commands?: unknown;
      findings?: unknown;
    };
    if (
      typeof parsed.passed !== "boolean" ||
      !Array.isArray(parsed.commands) ||
      !Array.isArray(parsed.findings)
    ) {
      return null;
    }

    const commands = parsed.commands.filter((item): item is string => typeof item === "string");
    const findings = parsed.findings.filter((item): item is string => typeof item === "string");
    if (commands.length !== parsed.commands.length || findings.length !== parsed.findings.length) {
      return null;
    }

    return {
      passed: parsed.passed,
      commands,
      findings,
    };
  } catch {
    return null;
  }
}

function validateExecutionPlan(value: unknown): ExecutionPlan | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as {
    goal?: unknown;
    steps?: unknown;
  };

  if (typeof data.goal !== "string" || data.goal.trim() === "") {
    return null;
  }

  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    return null;
  }

  const steps = data.steps
    .map((step) => {
      if (!step || typeof step !== "object") {
        return null;
      }

      const s = step as {
        id?: unknown;
        title?: unknown;
        targets?: unknown;
        rationale?: unknown;
        verification?: unknown;
      };

      if (
        typeof s.id !== "string" ||
        typeof s.title !== "string" ||
        typeof s.rationale !== "string" ||
        typeof s.verification !== "string" ||
        !Array.isArray(s.targets)
      ) {
        return null;
      }

      const targets = s.targets.filter((target): target is string => typeof target === "string");
      if (targets.length !== s.targets.length) {
        return null;
      }

      return {
        id: s.id.trim(),
        title: s.title.trim(),
        targets: targets.map((target) => target.trim()).filter(Boolean),
        rationale: s.rationale.trim(),
        verification: s.verification.trim(),
      };
    })
    .filter((step): step is NonNullable<typeof step> => !!step);

  if (steps.length === 0 || steps.length !== data.steps.length) {
    return null;
  }

  return {
    goal: data.goal.trim(),
    steps,
  };
}

function parseExecutionPlan(raw: string): ExecutionPlan | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return validateExecutionPlan(parsed);
  } catch {
    return null;
  }
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
        const approval = await requestApproval(tui, {
          kind: "web-fetch",
          target: rule,
        }, state.sessionId);
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

  const contextMaxSteps = Math.min(16, Math.max(8, Math.floor(request.maxSteps / 8)));
  const planningMaxSteps = Math.min(24, Math.max(10, Math.floor(request.maxSteps / 6)));
  const verificationMaxSteps = Math.min(24, Math.max(8, Math.floor(request.maxSteps / 6)));

  const runPhase = async (prompt: string, persistTranscript: boolean, maxSteps: number) =>
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
        maxSteps,
        timeoutMs: request.maxDurationMs,
        abortSignal: activeAbortController.signal,
      },
    );

  try {
    let contextResult = await runPhase(
      buildContextGatheringPrompt(request.task),
      false,
      contextMaxSteps,
    );

    if (isContextBudgetResult(contextResult)) {
      const retrySteps = expandedContextSteps(request.maxSteps, contextMaxSteps);
      contextResult = await runPhase(
        buildContextGatheringPrompt(request.task),
        false,
        retrySteps,
      );
    }

    if (contextResult.status === "cancelled") {
      tui.renderSummary({
        success: false,
        steps: contextResult.steps,
        durationMs: Math.round(performance.now() - started),
        promptTokens: contextResult.usage?.promptTokens ?? 0,
        completionTokens: contextResult.usage?.completionTokens ?? 0,
        estimatedCostUsd: contextResult.estimatedCostUsd ?? 0,
      });
      return;
    }

    if (contextResult.status !== "completed") {
      if (!isContextBudgetResult(contextResult)) {
        tui.renderSummary({
          success: false,
          steps: contextResult.steps,
          durationMs: Math.round(performance.now() - started),
          promptTokens: contextResult.usage?.promptTokens ?? 0,
          completionTokens: contextResult.usage?.completionTokens ?? 0,
          estimatedCostUsd: contextResult.estimatedCostUsd ?? 0,
        });
        return;
      }
    }

    const planningPrompt = buildPlanningPrompt(request.task, contextResult.outputText);
    let planningResult = await runPhase(planningPrompt, false, planningMaxSteps);
    if (planningResult.status === "cancelled") {
      tui.renderSummary({
        success: false,
        steps: planningResult.steps,
        durationMs: Math.round(performance.now() - started),
        promptTokens: planningResult.usage?.promptTokens ?? 0,
        completionTokens: planningResult.usage?.completionTokens ?? 0,
        estimatedCostUsd: planningResult.estimatedCostUsd ?? 0,
      });
      return;
    }

    if (planningResult.status !== "completed") {
      tui.renderSummary({
        success: false,
        steps: planningResult.steps,
        durationMs: Math.round(performance.now() - started),
        promptTokens: planningResult.usage?.promptTokens ?? 0,
        completionTokens: planningResult.usage?.completionTokens ?? 0,
        estimatedCostUsd: planningResult.estimatedCostUsd ?? 0,
      });
      return;
    }

    let plan = parseExecutionPlan(planningResult.outputText);
    if (!plan) {
      planningResult = await runPhase(
        [
          "Your previous output was invalid.",
          "Return only valid JSON in this exact shape:",
          '{ "goal": string, "steps": [{ "id": string, "title": string, "targets": string[], "rationale": string, "verification": string }] }',
          "No markdown fences and no extra text.",
          "Original task:",
          request.task,
          "Previous invalid output:",
          planningResult.outputText || "(empty)",
        ].join("\n"),
        false,
        Math.max(8, Math.floor(planningMaxSteps / 2)),
      );
      plan = parseExecutionPlan(planningResult.outputText);
    }

    if (!plan) {
      tui.renderSummary({
        success: false,
        steps: Math.max(1, planningResult.steps),
        durationMs: Math.round(performance.now() - started),
        promptTokens:
          (contextResult.usage?.promptTokens ?? 0) + (planningResult.usage?.promptTokens ?? 0),
        completionTokens:
          (contextResult.usage?.completionTokens ?? 0) +
          (planningResult.usage?.completionTokens ?? 0),
        estimatedCostUsd:
          (contextResult.estimatedCostUsd ?? 0) + (planningResult.estimatedCostUsd ?? 0),
      });
      return;
    }

    tui.renderApprovalPrompt({
      message: "Plan prepared. Starting implementation...",
      options: ["running"],
    });
    const attemptImplementationAndVerification = async (implementationPrompt: string) => {
      phase.beginImplementation();
      const implementationResult = await runPhase(implementationPrompt, true, request.maxSteps);

      let verificationResult:
        | {
            status: string;
            steps: number;
            outputText: string;
            usage?: {
              promptTokens: number;
              completionTokens: number;
              totalTokens: number;
            };
            estimatedCostUsd?: number;
          }
        | null = null;
      let verificationReport: VerificationReport | null = null;

      if (implementationResult.status === "completed") {
        phase.beginVerification();
        tui.renderApprovalPrompt({
          message: "Implementation completed. Running verification...",
          options: ["running"],
        });
        verificationResult = await runPhase(
          buildVerificationPrompt(request.task, JSON.stringify(plan, null, 2)),
          false,
          verificationMaxSteps,
        );
        if (verificationResult.status === "completed") {
          verificationReport = parseVerificationReport(verificationResult.outputText);
        }
      }

      return {
        implementationResult,
        verificationResult,
        verificationReport,
      };
    };

    let runOutcome = await attemptImplementationAndVerification(
      buildImplementationPrompt(request.task, JSON.stringify(plan, null, 2)),
    );

    const shouldRepair =
      runOutcome.implementationResult.status === "completed" &&
      runOutcome.verificationResult?.status === "completed" &&
      runOutcome.verificationReport?.passed === false;

    if (shouldRepair) {
      const report = runOutcome.verificationReport!;
      const repairPlanning = await runPhase(
        [
          "Create a repair plan from the failed verification report.",
          "Return strict JSON only:",
          '{ "goal": string, "steps": [{ "id": string, "title": string, "targets": string[], "rationale": string, "verification": string }] }',
          "Original task:",
          request.task,
          "Current plan:",
          JSON.stringify(plan),
          "Verification report:",
          JSON.stringify(report),
        ].join("\n"),
        false,
        Math.max(8, Math.floor(planningMaxSteps / 2)),
      );
      const repairedPlan = parseExecutionPlan(repairPlanning.outputText);
      if (repairPlanning.status === "completed" && repairedPlan) {
        plan = repairedPlan;
        tui.renderApprovalPrompt({
          message: "Verification failed. Applying repair plan...",
          options: ["running"],
        });
        const repairedOutcome = await attemptImplementationAndVerification(
          buildImplementationPrompt(
            request.task,
            JSON.stringify(plan, null, 2) +
              "\n\nApply this as a targeted repair pass using verification findings from the previous attempt.",
          ),
        );
        runOutcome = {
          implementationResult: repairedOutcome.implementationResult,
          verificationResult: repairedOutcome.verificationResult,
          verificationReport: repairedOutcome.verificationReport,
        };
        // Merge repair planning usage into context/planning bucket by shadowing planningResult usage later.
        planningResult = {
          ...planningResult,
          usage: mergeUsage(planningResult.usage, repairPlanning.usage),
          estimatedCostUsd:
            (planningResult.estimatedCostUsd ?? 0) + (repairPlanning.estimatedCostUsd ?? 0),
          steps: planningResult.steps + repairPlanning.steps,
        };
      }
    }

    const usage = mergeUsage(
      mergeUsage(
        mergeUsage(contextResult.usage, planningResult.usage),
        runOutcome.implementationResult.usage,
      ),
      runOutcome.verificationResult?.usage,
    );
    const verificationPassed =
      runOutcome.verificationResult == null
        ? true
        : runOutcome.verificationResult.status === "completed" &&
          (runOutcome.verificationReport?.passed ?? false);
    tui.renderSummary({
      success:
        (runOutcome.implementationResult.status === "completed" ||
          runOutcome.implementationResult.status === "cancelled") &&
        verificationPassed,
      steps: runOutcome.implementationResult.steps + (runOutcome.verificationResult?.steps ?? 0),
      durationMs: Math.round(performance.now() - started),
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      estimatedCostUsd:
        (contextResult.estimatedCostUsd ?? 0) +
        (planningResult.estimatedCostUsd ?? 0) +
        (runOutcome.implementationResult.estimatedCostUsd ?? 0) +
        (runOutcome.verificationResult?.estimatedCostUsd ?? 0),
    });
  } finally {
    clearInterval(spinner);
    tui.onCancelRunning(null);
    tui.renderApprovalPrompt(null);
  }
}
