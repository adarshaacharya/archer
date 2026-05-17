import { performance } from "node:perf_hooks";
import {
  buildPriorTurnPlanningGuidance,
  createCompactionMetadata,
  createTaskPhaseController,
  createToolApprovalHandler,
  createWebCompletedEvent,
  createWebFailedEvent,
  createWebStartedEvent,
  formatWebRuntimeEvent,
  deriveCompactionPolicy,
  deriveValidationScope,
  type HarnessRuntimeDeps,
  type HarnessToolEvent,
  recordCompactionAttempt,
  resolveObservedTurnIntent,
  type TurnObservedFacts,
} from "@archer/harness";
import { createSandboxEnvironment } from "@archer/sandbox";
import { autoApproveEditsInApprovalMode } from "@archer/shared/approval";
import type { ComposerSubmission } from "@archer/shared/composer";
import { AgentRequestSchema } from "@archer/shared/runtime";
import {
  appendMessage,
  getTurnResults,
  loadLatestCompactContinuationArtifact,
  saveCompactionEvent,
  updateSessionTitle,
} from "@archer/storage";
import type { Tui, UiEvent } from "@archer/tui";
import { createWebCapability } from "../../../../../packages/web-capability/src/index.js";
import { requestApproval, withApprovalQueue } from "../../features/approvals/approvals.js";
import { resolveActiveWebProvider } from "../../features/auth/auth-store.js";
import { buildExplicitFileContext } from "../../features/context/explicit-context.js";
import { createEvalMetricsCollector } from "../../features/runtime/eval-metrics.js";
import { pruneSessionAfterTurn } from "../../features/runtime/session-pruning.js";
import { titleFromTask } from "../../features/runtime/task-title.js";
import { createTurnStateMachine } from "../../features/runtime/turn-state-machine.js";
import type { TurnContext, TurnResult, TurnSummary } from "../../features/runtime/turn-types.js";
import type { SessionState } from "../../features/sessions/session-state.js";
import { webFetchRuleForUrl } from "../../features/settings/settings-store.js";
import { formatSubagentRuntimeEvent } from "../../features/subagents/subagent-events.js";
import { executeHarnessRoute } from "../run-task/harness-route.js";
import { isSuccessfulGitCommitOutput, shellOutputText } from "../run-task/output.js";
import { turnStatusLabel } from "../run-task/status.js";
import { ensureWebProviderConnected, updateWebSessionState } from "../run-task/web-provider.js";

function newMessageId(sessionId: string, role: string): string {
  return `${sessionId}_${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

type PatchPreview = NonNullable<HarnessRuntimeDeps["approvePatchApply"]> extends (
  preview: infer T,
) => unknown
  ? T
  : never;

type RuntimeToolCall = Parameters<NonNullable<HarnessRuntimeDeps["approveToolCall"]>>[0];

export async function runTask(
  submission: ComposerSubmission,
  tui: Tui,
  state: SessionState,
  abortController?: AbortController,
  intent?: TurnResult["intent"],
  taskOptions?: {
    workflowKind?: "default" | "commit" | "compact";
    displayTask?: string;
  },
): Promise<TurnResult> {
  const activeAbortController = abortController ?? new AbortController();
  const request = AgentRequestSchema.parse({
    task: submission.text,
    repoRoot: state.projectRoot,
    approvalMode: state.approvalMode,
    maxSteps: 256,
    maxDurationMs: 120000,
  });
  const explicitFileContext = await buildExplicitFileContext(submission, state.projectRoot);

  if (!state.sessionTitle) {
    state.sessionTitle = titleFromTask(taskOptions?.displayTask ?? request.task);
    await updateSessionTitle({
      id: state.sessionId,
      title: state.sessionTitle,
    });
  }

  tui.emit({
    type: "approval-prompt",
    prompt: {
      message: taskOptions?.displayTask ?? request.task,
      options: ["running"],
    },
  });

  const started = performance.now();
  const unifiedTurn = intent == null;
  const declaredIntent: TurnResult["intent"] = intent ?? "question";
  const continuationArtifact = await loadLatestCompactContinuationArtifact(state.sessionId);
  const recentTurns = await getTurnResults(state.sessionId, 5);
  const priorTurnGuidance = buildPriorTurnPlanningGuidance(recentTurns);
  const compactionPolicy = deriveCompactionPolicy(recentTurns);
  const turnContext: TurnContext = {
    sessionId: state.sessionId,
    task: request.task,
    projectRoot: state.projectRoot,
    approvalMode: state.approvalMode,
    modelId: state.modelId,
    startedAt: started,
  };
  const patchApprovedPaths = new Set<string>();
  const evalMetrics = createEvalMetricsCollector();
  let compactionMetadata = createCompactionMetadata(compactionPolicy);
  let commitWorkflowCompleted = false;
  let commitWorkflowOutput = "";
  const observedFacts: TurnObservedFacts = {
    changeFlowEntered: declaredIntent === "change" || taskOptions?.workflowKind === "commit",
    implementationAttempted: false,
    verificationAttempted: false,
  };
  const phase = createTaskPhaseController();
  const turn = createTurnStateMachine();
  turn.transition("routing");
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;
  let promptPending = false;
  let isChangeTurn = declaredIntent === "change";
  let isAnswerTurn = !isChangeTurn;
  const spinner = setInterval(() => {
    if (promptPending) {
      return;
    }

    const frame = spinnerFrames[frameIndex % spinnerFrames.length];
    frameIndex += 1;
    tui.emit({
      type: "approval-prompt",
      prompt: {
        message: `${frame} ${turnStatusLabel(turn.state)}...`,
        options: ["esc=abort"],
      },
    });
  }, 120);

  const env = createSandboxEnvironment({
    cwd: request.repoRoot,
    approvalMode: state.approvalMode,
    approvals: async (approvalRequest) => {
      if (approvalRequest.kind === "file-write" && patchApprovedPaths.has(approvalRequest.target)) {
        patchApprovedPaths.delete(approvalRequest.target);
        return "once";
      }
      promptPending = true;
      try {
        evalMetrics.recordApproval();
        return await requestApproval(tui, approvalRequest, state.sessionId);
      } finally {
        promptPending = false;
      }
    },
  });

  tui.emit({ type: "user-message", message: taskOptions?.displayTask ?? request.task });
  await appendMessage({
    id: newMessageId(state.sessionId, "user"),
    session_id: state.sessionId,
    role: "user",
    kind: "transcript",
    content: taskOptions?.displayTask ?? request.task,
  });

  const baseWeb = createWebCapability(
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
      allowUrl: async (url: string) => {
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
  const web = {
    async execute(action: Parameters<typeof baseWeb.execute>[0]) {
      const startedEvent = createWebStartedEvent(action);
      evalMetrics.onWebEvent(startedEvent);
      persistEventMessage(formatWebRuntimeEvent(startedEvent));
      try {
        const result = await baseWeb.execute(action);
        const completedEvent = createWebCompletedEvent(result);
        evalMetrics.onWebEvent(completedEvent);
        persistEventMessage(formatWebRuntimeEvent(completedEvent));
        return result;
      } catch (error) {
        const failedEvent = createWebFailedEvent(
          action,
          error instanceof Error ? error.message : String(error),
        );
        evalMetrics.onWebEvent(failedEvent);
        persistEventMessage(formatWebRuntimeEvent(failedEvent));
        throw error;
      }
    },
  };

  const requestApprovalForTool = async (approvalRequest: Parameters<typeof requestApproval>[1]) => {
    promptPending = true;
    try {
      evalMetrics.recordApproval();
      return await requestApproval(tui, approvalRequest, state.sessionId);
    } finally {
      promptPending = false;
    }
  };

  const buildSummary = (
    fields: Omit<TurnSummary, "compaction" | "evalMetrics"> &
      Partial<Pick<TurnSummary, "evalMetrics">>,
  ): TurnSummary => ({
    ...fields,
    compaction: compactionMetadata,
    evalMetrics: fields.evalMetrics ?? evalMetrics.summarize(),
  });

  const resolvedIntent = (): TurnResult["intent"] =>
    resolveObservedTurnIntent(observedFacts, evalMetrics.currentChangedPaths());

  const buildTurnResult = (
    status: TurnResult["status"],
    summary?: TurnSummary,
    message?: string,
  ): TurnResult => ({
    status,
    intent: resolvedIntent(),
    task: turnContext.task,
    summary,
    message,
  });

  const elapsedMs = () => Math.round(performance.now() - started);
  const emitUiEvent = (event: UiEvent) => tui.emit(event);
  const persistAssistantTranscript = (message: string) => {
    emitUiEvent({ type: "finalize-assistant", text: message });
    void appendMessage({
      id: newMessageId(state.sessionId, "assistant"),
      session_id: state.sessionId,
      role: "assistant",
      kind: "transcript",
      content: message,
    });
  };
  const persistEventMessage = (message: string) => {
    if (!message.trim()) {
      return;
    }
    emitUiEvent({ type: "event-message", message });
    void appendMessage({
      id: newMessageId(state.sessionId, "event"),
      session_id: state.sessionId,
      role: "system",
      kind: "event",
      content: message,
    });
  };
  const formatHarnessEvent = (event: {
    type: string;
    step?: number;
    action?: string;
    detail?: string;
    error?: string;
    reason?: string;
  }): string | null => {
    if (event.type === "turn.progress") {
      const step = event.step ? `step ${event.step}` : "step";
      const action = event.action ?? "progress";
      const detail = event.detail ? ` (${event.detail})` : "";
      return `Harness ${step}: ${action}${detail}`;
    }
    if (event.type === "turn.awaiting_approval") {
      return `Harness awaiting approval: ${event.reason ?? "approval required"}`;
    }
    if (event.type === "turn.failed") {
      return `Harness failure: ${event.error ?? "unknown error"}`;
    }
    return null;
  };
  const pruneAfterTurn = () => {
    void pruneSessionAfterTurn(state.sessionId);
  };
  const updateCompactionMetadata = (input: {
    trigger: "context-pressure";
    completed: boolean;
    report: {
      summary: string;
      criticalFiles: string[];
      openRisks: string[];
    } | null;
  }) => {
    compactionMetadata = recordCompactionAttempt(compactionMetadata, input);
  };
  const saveCompactionStarted = () =>
    saveCompactionEvent({
      sessionId: state.sessionId,
      event: {
        trigger: "context-pressure",
        status: "started",
        summary: null,
        criticalFiles: [],
        openRisks: [],
        createdAt: Date.now(),
      },
    });
  const saveCompactionCompleted = (input: {
    completed: boolean;
    summary: string | null;
    criticalFiles: string[];
    openRisks: string[];
  }) =>
    saveCompactionEvent({
      sessionId: state.sessionId,
      event: {
        trigger: "context-pressure",
        status: input.completed ? "succeeded" : "failed",
        summary: input.summary,
        criticalFiles: input.criticalFiles,
        openRisks: input.openRisks,
        createdAt: Date.now(),
      },
    });
  const deriveCurrentValidationScope = () =>
    deriveValidationScope({
      workflowKind: taskOptions?.workflowKind,
      changedPaths: evalMetrics.currentChangedPaths(),
    });

  const approveToolCall = createToolApprovalHandler({
    approvalMode: state.approvalMode,
    phase,
    patchApprovedPaths,
    requestApproval: requestApprovalForTool,
    allowBashInContext: taskOptions?.workflowKind === "commit",
  });

  const approvePatchApply = async (preview: PatchPreview) => {
    if (!isChangeTurn) {
      return false;
    }

    if (phase.isContextPhase()) {
      return false;
    }

    if (autoApproveEditsInApprovalMode(state.approvalMode)) {
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

  const approveToolCallWithQuestionReadiness = async (toolCall: RuntimeToolCall): Promise<boolean> =>
    approveToolCall({
      toolName: toolCall.toolName,
      input: toolCall.args,
    });

  try {
    const harnessMode = declaredIntent === "change" ? "change" : "answer";
    if (harnessMode === "change") {
      observedFacts.changeFlowEntered = true;
    }
    return executeHarnessRoute({
      mode: harnessMode,
      task: request.task,
      repoRoot: request.repoRoot,
      modelId: state.modelId,
      sessionId: state.sessionId,
      maxSteps: request.maxSteps,
      maxDurationMs: request.maxDurationMs,
      env,
      harnessConfig: state.harnessConfig,
      requestApprovalForTool: async (approvalRequest) => {
        if (approvalRequest.permission === "read") {
          return true;
        }
        const approval = await requestApprovalForTool({
          kind: approvalRequest.permission === "bash" ? "command" : "file-write",
          target: approvalRequest.toolName,
          details: approvalRequest.reason,
        });
        return approval !== "reject";
      },
      elapsedMs,
      buildSummary,
      buildTurnResult,
      onCompleted: (message) => {
        evalMetrics.recordFinalMessage(message);
        persistAssistantTranscript(message);
        pruneAfterTurn();
        turn.finish();
      },
      onFailed: (message) => {
        const safeMessage = message?.trim() || "Harness run failed.";
        persistAssistantTranscript(`I couldn't complete that turn: ${safeMessage}`);
        turn.fail();
      },
      onEvent: (event) => {
        const rendered = formatHarnessEvent(event);
        if (rendered) {
          persistEventMessage(rendered);
        }
      },
      onAssistantDelta: (delta) => {
        if (delta) {
          emitUiEvent({ type: "assistant-delta", delta });
        }
      },
    });

  } finally {
    clearInterval(spinner);
    tui.onCancelRunning(null);
    tui.emit({ type: "approval-prompt", prompt: null });
  }
}
