import { performance } from "node:perf_hooks";
import {
  accumulatePlanningResult,
  buildCompactionPrompt,
  createCompactionMetadata,
  buildRepairPlanningPrompt,
  buildQuestionLimitFinalAnswerPrompt,
  didVerificationPass,
  deriveCompactionPolicy,
  type ImplementationRunOutcome,
  isContextPressureFailure,
  parseCompactionReport,
  recordCompactionAttempt,
  mergeUsage,
  type OpenHarnessRuntimeDeps,
  type VerificationReport,
  buildPriorTurnPlanningGuidance,
  buildContextGatheringPrompt,
  buildDirectAnswerPrompt,
  buildDirectAnswerSystemPrompt,
  buildImplementationPrompt,
  buildPlanningPrompt,
  buildQuestionStrategy,
  buildResearchAnswerPrompt,
  buildVerificationPrompt,
  createQuestionExplorationState,
  createTaskPhaseController,
  createToolApprovalHandler,
  expandedContextSteps,
  evaluateQuestionAnswerReadiness,
  isContextBudgetResult,
  isMaxStepsResult,
  parseExecutionPlan,
  parseVerificationReport,
  prependContinuationBrief,
  recordQuestionStep,
  runOpenHarnessRuntime,
  shouldRepairImplementationOutcome,
  shouldInspectRepositoryForQuestion,
  summarizeQuestionExploration,
} from "@xeq/agent-core";
import { createSandboxEnvironment } from "@xeq/sandbox";
import { AgentRequestSchema, autoApproveEditsInApprovalMode } from "@xeq/shared";
import {
  appendMessage,
  getTurnResults,
  loadLatestCompactContinuationArtifact,
  updateSessionTitle,
} from "@xeq/storage";
import type { Tui } from "@xeq/tui";
import { createWebSearchProvider } from "@xeq/web";
import { requestApproval, withApprovalQueue } from "./approvals.js";
import { createEvalMetricsCollector } from "./eval-metrics.js";
import { resolveActiveWebProvider } from "./auth-store.js";
import { pruneSessionAfterTurn } from "./recovery/prune.js";
import type { SessionState } from "./session-state.js";
import { webFetchRuleForUrl } from "./settings-store.js";
import { titleFromTask } from "./task-title.js";
import { createTurnStateMachine } from "./turn-state-machine.js";
import type { TurnContext, TurnResult, TurnSummary } from "./turn-types.js";

function newMessageId(sessionId: string, role: string): string {
  return `${sessionId}_${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

type PatchPreview = NonNullable<OpenHarnessRuntimeDeps["approvePatchApply"]> extends (
  preview: infer T,
) => unknown
  ? T
  : never;

type RuntimeToolCall = Parameters<NonNullable<OpenHarnessRuntimeDeps["approveToolCall"]>>[0];

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

function turnStatusLabel(stateName: string, intent: TurnContext["intent"]): string {
  switch (stateName) {
    case "routing":
      return "Routing turn";
    case "researching":
      return intent === "change" ? "Gathering context" : "Researching";
    case "planning":
      return "Planning";
    case "implementing":
      return "Implementing";
    case "verifying":
      return "Verifying";
    case "repairing":
      return "Repairing";
    case "compacting":
      return "Compacting context";
    default:
      return "Processing task";
  }
}

export async function runTask(
  task: string,
  tui: Tui,
  state: SessionState,
  abortController?: AbortController,
  intent: TurnContext["intent"] = "change",
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
  const recentTurns = await getTurnResults(state.sessionId, 5);
  const priorTurnGuidance = buildPriorTurnPlanningGuidance(recentTurns);
  const compactionPolicy = deriveCompactionPolicy(recentTurns);
  const turnContext: TurnContext = {
    sessionId: state.sessionId,
    task: request.task,
    intent,
    projectRoot: state.projectRoot,
    approvalMode: state.approvalMode,
    modelId: state.modelId,
    startedAt: started,
  };
  const patchApprovedPaths = new Set<string>();
  const evalMetrics = createEvalMetricsCollector();
  let compactionMetadata = createCompactionMetadata(compactionPolicy);
  const phase = createTaskPhaseController();
  const turn = createTurnStateMachine(intent);
  turn.transition("routing");
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
      message: `${frame} ${turnStatusLabel(turn.state, intent)}...`,
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
      evalMetrics.recordApproval();
      return await requestApproval(tui, approvalRequest, state.sessionId);
    } finally {
      promptPending = false;
    }
  };

  const buildSummary = (
    fields: Omit<TurnSummary, "compaction" | "evalMetrics"> & Partial<Pick<TurnSummary, "evalMetrics">>,
  ): TurnSummary => ({
    ...fields,
    compaction: compactionMetadata,
    evalMetrics: fields.evalMetrics ?? evalMetrics.summarize(),
  });

  const approveToolCall = createToolApprovalHandler({
    approvalMode: state.approvalMode,
    phase,
    patchApprovedPaths,
    requestApproval: requestApprovalForTool,
  });

  const approvePatchApply = async (preview: PatchPreview) => {
    if (intent !== "change") {
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
  const inspectRepositoryForQuestion = shouldInspectRepositoryForQuestion(request.task, intent);
  const questionStrategy =
    intent === "change" || !inspectRepositoryForQuestion
      ? null
      : buildQuestionStrategy(request.task, intent === "research" ? "research" : "question");
  const questionExploration = questionStrategy ? createQuestionExplorationState() : null;
  let questionAnswerReadyReason: string | null = null;
  const researchMaxSteps = questionStrategy
    ? request.maxSteps
    : Math.min(192, Math.max(64, Math.floor(request.maxSteps * 0.75)));

  const approveToolCallWithQuestionReadiness = async (
    toolCall: RuntimeToolCall,
  ): Promise<boolean> => {
    if (questionStrategy && questionExploration && intent !== "change") {
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

  const runPhase = async (
    prompt: string,
    persistTranscript: boolean,
    maxSteps: number,
    options: { allowTools?: boolean; instructions?: string } = {},
  ) =>
    runOpenHarnessRuntime(
      {
        modelId: state.modelId,
        sessionId: state.sessionId,
        instructions: options.instructions,
        providers: {
          ...env,
          webSearch,
        },
        approveToolCall:
          options.allowTools === false ? () => false : approveToolCallWithQuestionReadiness,
        approvePatchApply: options.allowTools === false ? () => false : approvePatchApply,
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

  try {
    turn.beginResearch();
    if (questionStrategy) {
      tui.renderApprovalPrompt({
        message: "Researching repository context...",
        options: ["esc=abort"],
      });
    }
    const directQuestion = intent === "question" && !questionStrategy;
    const researchPrompt = directQuestion
      ? buildDirectAnswerPrompt(request.task)
      : prependContinuationBrief(
          intent === "change"
            ? buildContextGatheringPrompt(request.task)
            : buildResearchAnswerPrompt(request.task, intent, questionStrategy ?? undefined),
          continuationArtifact,
        );
    let contextResult = await runPhase(
      researchPrompt,
      intent !== "change",
      intent === "change" ? contextMaxSteps : questionStrategy ? researchMaxSteps : 12,
      directQuestion
        ? {
            allowTools: false,
            instructions: buildDirectAnswerSystemPrompt(),
          }
        : {},
    );

    if (intent === "change" && isContextBudgetResult(contextResult)) {
      const retrySteps = expandedContextSteps(request.maxSteps, contextMaxSteps);
      contextResult = await runPhase(researchPrompt, false, retrySteps);
    }

    if (intent !== "change") {
      const explorationSummary = questionExploration
        ? summarizeQuestionExploration(questionExploration)
        : undefined;
      const baseSummary = {
        success: contextResult.status === "completed",
        steps: contextResult.steps,
        durationMs: Math.round(performance.now() - started),
        promptTokens: contextResult.usage?.promptTokens ?? 0,
        completionTokens: contextResult.usage?.completionTokens ?? 0,
        estimatedCostUsd: contextResult.estimatedCostUsd ?? 0,
        compaction: compactionMetadata,
        evalMetrics: evalMetrics.summarize(),
        ...(explorationSummary ? { exploration: explorationSummary } : {}),
      };

      if (contextResult.status === "completed") {
        const message = contextResult.outputText.trim();
        turn.finish();
        tui.renderSummary({ ...baseSummary, success: true });
        void pruneSessionAfterTurn(state.sessionId);
        return {
          status: "completed",
          intent: turnContext.intent,
          task: turnContext.task,
          summary: { ...baseSummary, success: true },
          message: message || undefined,
        };
      }

      const partialAnswer = contextResult.outputText.trim();
      if (partialAnswer) {
        const limitReason = contextResult.error
          ? contextResult.error
          : "the runtime stopped before more files could be inspected";
        const message = `${partialAnswer}\n\nNote: ${limitReason}. This answer is based on the useful evidence collected so far.`;
        tui.finalizeAssistantStream(message);
        void appendMessage({
          id: newMessageId(state.sessionId, "assistant"),
          session_id: state.sessionId,
          role: "assistant",
          kind: "transcript",
          content: message,
        });
        turn.finish();
        tui.renderSummary({ ...baseSummary, success: true });
        void pruneSessionAfterTurn(state.sessionId);
        return {
          status: "completed",
          intent: turnContext.intent,
          task: turnContext.task,
          summary: { ...baseSummary, success: true },
          message,
        };
      }

      if (isMaxStepsResult(contextResult) || questionAnswerReadyReason) {
        const finalAnswerResult = await runPhase(
          buildQuestionLimitFinalAnswerPrompt(
            request.task,
            questionAnswerReadyReason
              ? `The question turn became answer-ready: ${questionAnswerReadyReason}.`
              : (contextResult.error ?? "The question turn reached its exploration limit."),
          ),
          true,
          24,
          { allowTools: false },
        );
        const finalAnswer = finalAnswerResult.outputText.trim();
        if (finalAnswer) {
          const message =
            finalAnswerResult.status === "completed"
              ? finalAnswer
              : `${finalAnswer}\n\nNote: final answer synthesis stopped early after the exploration limit.`;
          if (finalAnswerResult.status !== "completed") {
            tui.finalizeAssistantStream(message);
            void appendMessage({
              id: newMessageId(state.sessionId, "assistant"),
              session_id: state.sessionId,
              role: "assistant",
              kind: "transcript",
              content: message,
            });
          }
          turn.finish();
          const summary = {
            ...baseSummary,
            success: true,
            steps: baseSummary.steps + finalAnswerResult.steps,
            promptTokens: baseSummary.promptTokens + (finalAnswerResult.usage?.promptTokens ?? 0),
            completionTokens:
              baseSummary.completionTokens + (finalAnswerResult.usage?.completionTokens ?? 0),
            estimatedCostUsd:
              baseSummary.estimatedCostUsd + (finalAnswerResult.estimatedCostUsd ?? 0),
          };
          tui.renderSummary(summary);
          void pruneSessionAfterTurn(state.sessionId);
          return {
            status: "completed",
            intent: turnContext.intent,
            task: turnContext.task,
            summary,
            message,
          };
        }
      }

      if (contextResult.status === "cancelled") {
        turn.cancel();
        tui.renderSummary(baseSummary);
        return {
          status: "cancelled",
          intent: turnContext.intent,
          task: turnContext.task,
          summary: baseSummary,
          message: contextResult.error,
        };
      }

      turn.fail();
      tui.renderAssistantMessage(
        contextResult.error
          ? `Research failed: ${contextResult.error}`
          : "Research failed before an answer could be produced.",
      );
      tui.renderSummary(baseSummary);
      void pruneSessionAfterTurn(state.sessionId);
      return {
        status: "failed",
        intent: turnContext.intent,
        task: turnContext.task,
        summary: baseSummary,
        message: contextResult.error ?? "Research failed before an answer could be produced.",
      };
    }

    if (contextResult.status === "cancelled") {
      turn.cancel();
      const summary = {
        ...buildSummary({
          success: false,
          steps: contextResult.steps,
          durationMs: Math.round(performance.now() - started),
          promptTokens: contextResult.usage?.promptTokens ?? 0,
          completionTokens: contextResult.usage?.completionTokens ?? 0,
          estimatedCostUsd: contextResult.estimatedCostUsd ?? 0,
        }),
      };
      tui.renderSummary(summary);
      return {
        status: "cancelled",
        intent: turnContext.intent,
        task: turnContext.task,
        summary,
        message: contextResult.error,
      };
    }

    if (contextResult.status !== "completed") {
      if (!isContextBudgetResult(contextResult)) {
        turn.fail();
        const summary = {
          ...buildSummary({
            success: false,
            steps: contextResult.steps,
            durationMs: Math.round(performance.now() - started),
            promptTokens: contextResult.usage?.promptTokens ?? 0,
            completionTokens: contextResult.usage?.completionTokens ?? 0,
            estimatedCostUsd: contextResult.estimatedCostUsd ?? 0,
          }),
        };
        tui.renderSummary(summary);
        return {
          status: "failed",
          intent: turnContext.intent,
          task: turnContext.task,
          summary,
          message: contextResult.error,
        };
      }
    }

    turn.beginPlanning();
    const planningPrompt = buildPlanningPrompt(
      request.task,
      contextResult.outputText,
      priorTurnGuidance ?? undefined,
    );
    let planningResult = await runPhase(planningPrompt, false, planningMaxSteps);
    if (planningResult.status === "cancelled") {
      turn.cancel();
      const summary = buildSummary({
        success: false,
        steps: planningResult.steps,
        durationMs: Math.round(performance.now() - started),
        promptTokens: planningResult.usage?.promptTokens ?? 0,
        completionTokens: planningResult.usage?.completionTokens ?? 0,
        estimatedCostUsd: planningResult.estimatedCostUsd ?? 0,
      });
      tui.renderSummary(summary);
      return { status: "cancelled", intent: turnContext.intent, task: turnContext.task, summary };
    }

    if (planningResult.status !== "completed") {
      turn.fail();
      const summary = buildSummary({
        success: false,
        steps: planningResult.steps,
        durationMs: Math.round(performance.now() - started),
        promptTokens: planningResult.usage?.promptTokens ?? 0,
        completionTokens: planningResult.usage?.completionTokens ?? 0,
        estimatedCostUsd: planningResult.estimatedCostUsd ?? 0,
      });
      tui.renderSummary(summary);
      return {
        status: "failed",
        intent: turnContext.intent,
        task: turnContext.task,
        summary,
        message: planningResult.error,
      };
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
      turn.fail();
      const summary = buildSummary({
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
      tui.renderSummary(summary);
      return {
        status: "failed",
        intent: turnContext.intent,
        task: turnContext.task,
        summary,
        message: "Planning output was invalid.",
      };
    }

    tui.renderApprovalPrompt({
      message: "Plan prepared. Starting implementation...",
      options: ["running"],
    });
    const attemptImplementationAndVerification = async (implementationPrompt: string) => {
      turn.beginImplementation();
      phase.beginImplementation();
      const implementationResult = await runPhase(implementationPrompt, true, request.maxSteps);

      let verificationResult: {
        status: string;
        steps: number;
        outputText: string;
        usage?: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        };
        estimatedCostUsd?: number;
      } | null = null;
      let verificationReport: VerificationReport | null = null;

      if (implementationResult.status === "completed") {
        turn.beginVerification();
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

    let runOutcome: ImplementationRunOutcome = await attemptImplementationAndVerification(
      buildImplementationPrompt(request.task, JSON.stringify(plan, null, 2)),
    );

    if (isContextPressureFailure(runOutcome.implementationResult)) {
      turn.beginCompaction();
      const compactRun = await runPhase(
        buildCompactionPrompt(
          request.task,
          JSON.stringify(plan, null, 2),
          runOutcome.implementationResult.outputText,
        ),
        false,
        compactionMaxSteps,
      );
      const compacted =
        compactRun.status === "completed" ? parseCompactionReport(compactRun.outputText) : null;
      compactionMetadata = recordCompactionAttempt(compactionMetadata, {
        trigger: "context-pressure",
        completed: compactRun.status === "completed",
        report: compacted,
      });

      if (compacted) {
        tui.renderApprovalPrompt({
          message: "Context pressure detected. Retrying with compacted context...",
          options: ["running"],
        });
        runOutcome = await attemptImplementationAndVerification(
          buildImplementationPrompt(
            request.task,
            [
              JSON.stringify(plan, null, 2),
              "Compacted continuation brief:",
              JSON.stringify(compacted, null, 2),
            ].join("\n\n"),
          ),
        );
      }

      planningResult = accumulatePlanningResult(planningResult, compactRun);
    }

    const shouldRepair = shouldRepairImplementationOutcome(runOutcome);

    if (shouldRepair) {
      turn.beginRepair();
      const report = runOutcome.verificationReport;
      if (!report) {
        throw new Error("Repair requested without a verification report.");
      }
      const repairPlanning = await runPhase(
        buildRepairPlanningPrompt(request.task, JSON.stringify(plan), JSON.stringify(report)),
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
            `${JSON.stringify(plan, null, 2)}\n\nApply this as a targeted repair pass using verification findings from the previous attempt.`,
          ),
        );
        runOutcome = {
          implementationResult: repairedOutcome.implementationResult,
          verificationResult: repairedOutcome.verificationResult,
          verificationReport: repairedOutcome.verificationReport,
        };
        // Merge repair planning usage into context/planning bucket by shadowing planningResult usage later.
        planningResult = accumulatePlanningResult(planningResult, repairPlanning);
      }
    }

    const usage = mergeUsage(
      mergeUsage(
        mergeUsage(contextResult.usage, planningResult.usage),
        runOutcome.implementationResult.usage,
      ),
      runOutcome.verificationResult?.usage,
    );
    const verificationPassed = didVerificationPass(
      runOutcome.verificationResult,
      runOutcome.verificationReport,
    );
    if (
      (runOutcome.implementationResult.status === "completed" ||
        runOutcome.implementationResult.status === "cancelled") &&
      verificationPassed
    ) {
      turn.finish();
    } else if (runOutcome.implementationResult.status === "cancelled") {
      turn.cancel();
    } else {
      turn.fail();
    }
    const summary = {
      ...buildSummary({
        success: turn.state === "done",
        steps: runOutcome.implementationResult.steps + (runOutcome.verificationResult?.steps ?? 0),
        durationMs: Math.round(performance.now() - started),
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        estimatedCostUsd:
          (contextResult.estimatedCostUsd ?? 0) +
          (planningResult.estimatedCostUsd ?? 0) +
          (runOutcome.implementationResult.estimatedCostUsd ?? 0) +
          (runOutcome.verificationResult?.estimatedCostUsd ?? 0),
      }),
    };
    tui.renderSummary(summary);
    void pruneSessionAfterTurn(state.sessionId);
    return {
      status:
        turn.state === "done" ? "completed" : turn.state === "cancelled" ? "cancelled" : "failed",
      intent: turnContext.intent,
      task: turnContext.task,
      summary,
      message: turn.state === "failed" ? runOutcome.implementationResult.error : undefined,
    };
  } finally {
    clearInterval(spinner);
    tui.onCancelRunning(null);
    tui.renderApprovalPrompt(null);
  }
}
