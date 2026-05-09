import { performance } from "node:perf_hooks";
import {
  buildPriorTurnPlanningGuidance,
  buildQuestionStrategy,
  createCompactionMetadata,
  createOpenHarnessEngineAdapter,
  createQuestionExplorationState,
  createTaskPhaseController,
  createToolApprovalHandler,
  createWebCompletedEvent,
  createWebFailedEvent,
  createWebStartedEvent,
  deriveCompactionPolicy,
  deriveValidationScope,
  evaluateQuestionAnswerReadiness,
  formatWebRuntimeEvent,
  isContextBudgetResult,
  isContextPressureFailure,
  type OpenHarnessRuntimeDeps,
  type OpenHarnessToolEvent,
  parseCompactionReport,
  parseTurnDecision,
  type RuntimePhaseRunner,
  recordCompactionAttempt,
  recordQuestionStep,
  resolveObservedTurnIntent,
  shouldAttemptVerification,
  type TurnObservedFacts,
  validateTurnDecision,
} from "@archer/agent-core";
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
import type { Tui } from "@archer/tui";
import { createWebCapability } from "../../../../../packages/web-capability/src/index.js";
import { requestApproval, withApprovalQueue } from "../../features/approvals/approvals.js";
import { resolveActiveWebProvider } from "../../features/auth/auth-store.js";
import { buildExplicitFileContext } from "../../features/context/explicit-context.js";
import {
  type PreRouteResult,
  planPreRoute,
  preRouteResultFromMode,
} from "../../features/routing/intent-router.js";
import { createEvalMetricsCollector } from "../../features/runtime/eval-metrics.js";
import { pruneSessionAfterTurn } from "../../features/runtime/session-pruning.js";
import { titleFromTask } from "../../features/runtime/task-title.js";
import { createTurnStateMachine } from "../../features/runtime/turn-state-machine.js";
import type { TurnContext, TurnResult, TurnSummary } from "../../features/runtime/turn-types.js";
import type { SessionState } from "../../features/sessions/session-state.js";
import { webFetchRuleForUrl } from "../../features/settings/settings-store.js";
import { formatSubagentRuntimeEvent } from "../../features/subagents/subagent-events.js";
import { executeContextFlow } from "../run-task/context.js";
import { executeEarlyRoute } from "../run-task/execution.js";
import { isSuccessfulGitCommitOutput, shellOutputText } from "../run-task/output.js";
import { resolveTaskExecutionRoute } from "../run-task/route.js";
import { turnStatusLabel } from "../run-task/status.js";
import { ensureWebProviderConnected, updateWebSessionState } from "../run-task/web-provider.js";

function newMessageId(sessionId: string, role: string): string {
  return `${sessionId}_${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

type PatchPreview = NonNullable<OpenHarnessRuntimeDeps["approvePatchApply"]> extends (
  preview: infer T,
) => unknown
  ? T
  : never;

type RuntimeToolCall = Parameters<NonNullable<OpenHarnessRuntimeDeps["approveToolCall"]>>[0];

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

  tui.renderApprovalPrompt({
    message: taskOptions?.displayTask ?? request.task,
    options: ["running"],
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
    tui.renderApprovalPrompt({
      message: `${frame} ${turnStatusLabel(turn.state)}...`,
      options: ["esc=abort"],
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

  tui.renderUserMessage(taskOptions?.displayTask ?? request.task);
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
  const renderSummary = (summary: TurnSummary) => {
    tui.renderSummary(summary);
  };
  const renderApprovalMessage = (message: string) => {
    tui.renderApprovalPrompt({
      message,
      options: ["running"],
    });
  };
  const persistAssistantTranscript = (message: string) => {
    tui.finalizeAssistantStream(message);
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
    tui.renderEventMessage(message);
    void appendMessage({
      id: newMessageId(state.sessionId, "event"),
      session_id: state.sessionId,
      role: "system",
      kind: "event",
      content: message,
    });
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

  const contextMaxSteps = Math.min(16, Math.max(8, Math.floor(request.maxSteps / 8)));
  const planningMaxSteps = Math.min(24, Math.max(10, Math.floor(request.maxSteps / 6)));
  const verificationMaxSteps = Math.min(24, Math.max(8, Math.floor(request.maxSteps / 6)));
  const compactionMaxSteps = Math.min(18, Math.max(8, Math.floor(request.maxSteps / 10)));
  const preRoutePlan =
    taskOptions?.workflowKind == null || taskOptions.workflowKind === "default"
      ? explicitFileContext.hasFileMentions
        ? {
            status: "resolved" as const,
            result: preRouteResultFromMode(
              "repo-context",
              "structured file mentions require local repository context",
              "fast-path",
            ),
          }
        : planPreRoute(request.task)
      : null;
  if (
    preRoutePlan?.status === "resolved" &&
    preRoutePlan.result.mode === "change" &&
    declaredIntent !== "change"
  ) {
    isChangeTurn = true;
    isAnswerTurn = false;
    observedFacts.changeFlowEntered = true;
  }
  const questionStrategy = isAnswerTurn ? buildQuestionStrategy(request.task, "question") : null;
  const questionExploration = questionStrategy ? createQuestionExplorationState() : null;
  let questionAnswerReadyReason: string | null = null;
  const answerMaxSteps = request.maxSteps;
  const engine = createOpenHarnessEngineAdapter();

  const approveToolCallWithQuestionReadiness = async (
    toolCall: RuntimeToolCall,
  ): Promise<boolean> => {
    if (questionStrategy && questionExploration && isAnswerTurn) {
      const decision = evaluateQuestionAnswerReadiness(questionStrategy, questionExploration);
      if (decision.ready) {
        questionAnswerReadyReason ??= decision.reason;
        tui.renderApprovalPrompt({
          message: `Answer-ready: ${questionAnswerReadyReason}. Synthesizing...`,
          options: ["esc=abort"],
        });
        return false;
      }
    }

    return approveToolCall(toolCall);
  };

  const runPhase: RuntimePhaseRunner = async (
    prompt: string,
    persistTranscript: boolean,
    maxSteps: number,
    options: {
      allowTools?: boolean;
      allowedToolNames?: string[];
      instructions?: string;
      onToolEvent?: (event: OpenHarnessToolEvent) => void;
    } = {},
  ) =>
    engine.run(
      {
        modelId: state.modelId,
        sessionId: state.sessionId,
        instructions: options.instructions,
        runtimeConfig: state.openHarnessConfig,
        providers: {
          ...env,
          web,
        },
        approveToolCall: (toolCall) => {
          if (options.allowTools === false) {
            return false;
          }
          if (options.allowedToolNames && !options.allowedToolNames.includes(toolCall.toolName)) {
            return false;
          }
          return approveToolCallWithQuestionReadiness(toolCall);
        },
        approvePatchApply:
          options.allowTools === false || options.allowedToolNames != null
            ? () => false
            : approvePatchApply,
        onStep: (step) => {
          if (questionExploration && persistTranscript) {
            recordQuestionStep(questionExploration, step);
          }

          if (step.action === "model.final") {
            evalMetrics.recordFinalMessage(step.observation ?? "");
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
        onToolEvent: (event) => {
          evalMetrics.onToolEvent(event);
          const subagentMessage = formatSubagentRuntimeEvent(event);
          if (subagentMessage) {
            persistEventMessage(subagentMessage);
          }
          if (
            taskOptions?.workflowKind === "commit" &&
            event.phase === "done" &&
            event.toolName === "bash" &&
            isSuccessfulGitCommitOutput(event.output)
          ) {
            commitWorkflowCompleted = true;
            commitWorkflowOutput = shellOutputText(event.output).trim();
          }
          options.onToolEvent?.(event);
        },
        onTextDelta: persistTranscript
          ? (delta) => {
              tui.renderAssistantDelta(delta);
            }
          : undefined,
      },
      prompt,
      {
        cwd: request.repoRoot,
        maxSteps,
        timeoutMs: request.maxDurationMs,
        abortSignal: activeAbortController.signal,
      },
    );

  const classifyPreRouteDecision = async (): Promise<PreRouteResult | null> => {
    let submittedDecision: ReturnType<typeof validateTurnDecision> = null;
    const decisionResult = await runPhase(
      [
        "Route the user's input before any repository inspection.",
        "Do not inspect files, search the repository, run shell commands, or call any tool other than submitTurnDecision.",
        "Submit the routing decision with the submitTurnDecision tool.",
        "Do not return raw JSON when the tool is available.",
        "The decision shape is:",
        '{ mode: "direct-answer" | "web-context" | "repo-context" | "change", rationale: string }',
        "",
        'Use "direct-answer" for casual conversation or general questions answerable without local repository context.',
        'Use "web-context" when the user supplied a URL or needs external web content, but not local repository files.',
        'Use "repo-context" when answering correctly requires inspecting the local repository or files.',
        'Use "change" when the user is asking for code or file modifications.',
        "",
        "Task:",
        request.task,
      ].join("\n"),
      false,
      8,
      {
        allowedToolNames:
          preRoutePlan?.status === "needs-classification"
            ? preRoutePlan.allowedToolNames
            : ["submitTurnDecision"],
        instructions: [
          "You are classifying the user's next turn before any repository work begins.",
          "Do not inspect the repository and do not call any tools except submitTurnDecision.",
        ].join(" "),
        onToolEvent: (event) => {
          if (event.phase !== "done" || event.toolName !== "submitTurnDecision") {
            return;
          }
          const validated = validateTurnDecision(event.output);
          if (validated) {
            submittedDecision = validated;
          }
        },
      },
    );

    const decision = submittedDecision ?? parseTurnDecision(decisionResult.outputText);
    if (!decision) {
      return null;
    }
    const mode =
      decision.mode === "answer"
        ? "repo-context"
        : decision.mode === "web-context"
          ? "web-context"
          : decision.mode;
    return preRouteResultFromMode(mode, decision.rationale, "classifier");
  };

  try {
    const resolvedPreRoute =
      preRoutePlan?.status === "resolved"
        ? preRoutePlan.result
        : preRoutePlan?.status === "needs-classification"
          ? declaredIntent === "change" || taskOptions?.workflowKind === "commit"
            ? null
            : await classifyPreRouteDecision()
          : null;

    const executionRoute = resolveTaskExecutionRoute(resolvedPreRoute ?? null, declaredIntent);
    const allowedToolNames = resolvedPreRoute?.allowedToolNames ?? [];

    if (executionRoute === "change") {
      isChangeTurn = true;
      isAnswerTurn = false;
      observedFacts.changeFlowEntered = true;
    }

    const earlyRouteResult = await executeEarlyRoute({
      route: executionRoute,
      task: request.task,
      allowedToolNames,
      runPhase,
      renderApprovalMessage,
      elapsedMs,
      buildSummary,
      renderSummary,
      pruneAfterTurn,
      buildTurnResult,
      onCompleted: () => turn.finish(),
      onCancelled: () => turn.cancel(),
      onFailed: () => turn.fail(),
    });
    if (earlyRouteResult) {
      return earlyRouteResult as TurnResult;
    }

    const contextFlow = await executeContextFlow({
      request,
      declaredIntent,
      unifiedTurn,
      isAnswerTurn,
      isChangeTurn,
      questionStrategy,
      explicitFileContext,
      continuationArtifact,
      contextMaxSteps,
      answerMaxSteps,
      planningMaxSteps,
      verificationMaxSteps,
      compactionMaxSteps,
      taskWorkflowKind: taskOptions?.workflowKind,
      commitWorkflowCompleted,
      commitWorkflowOutput,
      stateSessionId: state.sessionId,
      started,
      priorTurnGuidance: priorTurnGuidance ?? undefined,
      questionAnswerReadyReason,
      questionExploration,
      runPhase,
      turn,
      phase,
      observedFacts,
      buildSummary,
      buildTurnResult,
      renderSummary,
      renderApprovalMessage,
      renderAssistantError: (message) => {
        tui.renderAssistantMessage(message);
      },
      persistAssistantTranscript,
      pruneAfterTurn,
      deriveCurrentValidationScope,
      isContextBudgetResult,
      shouldAttemptVerification,
      saveCompactionStarted,
      saveCompactionCompleted,
      updateCompactionMetadata,
      parseCompactionReport,
      isContextPressureFailure,
      pruneSessionAfterTurn,
    });
    isAnswerTurn = contextFlow.isAnswerTurn;
    isChangeTurn = contextFlow.isChangeTurn;
    return contextFlow.result;
  } finally {
    clearInterval(spinner);
    tui.onCancelRunning(null);
    tui.renderApprovalPrompt(null);
  }
}
