import { performance } from "node:perf_hooks";
import {
  buildContextGatheringPrompt,
  buildResearchAnswerPrompt,
  expandedContextSteps,
  handleTaskContextOutcome,
  parseTurnDecision,
  prependContinuationBrief,
  shouldContinueAfterContextFailure,
  shouldStopCommitWorkflowAfterContext,
  summarizeQuestionExploration,
  validateTurnDecision,
} from "@archer/agent-core";
import { prependExplicitFileContext } from "../../features/context/explicit-context.js";

type ContextDeps = {
  request: { task: string; maxSteps: number };
  declaredIntent: string;
  unifiedTurn: boolean;
  isAnswerTurn: boolean;
  isChangeTurn: boolean;
  questionStrategy: any;
  explicitFileContext: unknown;
  continuationArtifact: unknown;
  contextMaxSteps: number;
  answerMaxSteps: number;
  planningMaxSteps: number;
  verificationMaxSteps: number;
  compactionMaxSteps: number;
  taskWorkflowKind?: "default" | "commit" | "compact";
  commitWorkflowCompleted: boolean;
  commitWorkflowOutput: string;
  stateSessionId: string;
  started: number;
  priorTurnGuidance?: string;
  questionAnswerReadyReason: string | null;
  questionExploration: unknown;
  runPhase: any;
  turn: any;
  phase: any;
  observedFacts: {
    changeFlowEntered: boolean;
    implementationAttempted: boolean;
    verificationAttempted: boolean;
  };
  buildSummary: any;
  buildTurnResult: any;
  renderSummary: any;
  renderApprovalMessage: (message: string) => void;
  renderAssistantError: (message: string) => void;
  persistAssistantTranscript: any;
  pruneAfterTurn: () => void;
  deriveCurrentValidationScope: any;
  isContextBudgetResult: any;
  shouldAttemptVerification: any;
  saveCompactionStarted: any;
  saveCompactionCompleted: any;
  updateCompactionMetadata: any;
  parseCompactionReport: any;
  isContextPressureFailure: any;
  pruneSessionAfterTurn: (sessionId: string) => Promise<unknown> | void;
};

export async function executeContextFlow(deps: ContextDeps): Promise<{
  result: any;
  isAnswerTurn: boolean;
  isChangeTurn: boolean;
}> {
  let isAnswerTurn = deps.isAnswerTurn;
  let isChangeTurn = deps.isChangeTurn;
  deps.turn.beginResearch();
  if (deps.questionStrategy) {
    deps.renderApprovalMessage("Researching repository context...");
  }
  const researchPrompt = prependContinuationBrief(
    prependExplicitFileContext(
      isChangeTurn
        ? buildContextGatheringPrompt(deps.request.task)
        : buildResearchAnswerPrompt(deps.request.task, "question", deps.questionStrategy),
      deps.explicitFileContext as never,
    ),
    deps.continuationArtifact as never,
  );
  let contextResult = await deps.runPhase(
    researchPrompt,
    isAnswerTurn,
    isChangeTurn ? deps.contextMaxSteps : deps.answerMaxSteps,
    {},
  );

  if (
    shouldContinueAfterContextFailure({
      intent: deps.declaredIntent as never,
      status: contextResult.status,
      isContextBudgetResult: deps.isContextBudgetResult(contextResult),
    })
  ) {
    const retrySteps = expandedContextSteps(deps.request.maxSteps, deps.contextMaxSteps);
    contextResult = await deps.runPhase(researchPrompt, false, retrySteps);
  }

  if (deps.unifiedTurn && contextResult.status === "completed") {
    let submittedDecision: ReturnType<typeof validateTurnDecision> = null;
    const decisionResult = await deps.runPhase(
      [
        "Decide what the task needs next based on the task and inspected repository context.",
        "Submit the routing decision with the submitTurnDecision tool.",
        "Do not return raw JSON when the tool is available.",
        "The decision shape is:",
        '{ mode: "answer" | "change", rationale: string }',
        "",
        'Use "answer" when the user primarily asked for inspection, explanation, review, or current state.',
        'Use "change" when the user clearly wants code or file modifications.',
        "",
        "Task:",
        deps.request.task,
        "",
        "Inspected context summary:",
        contextResult.outputText || "(empty)",
      ].join("\n"),
      false,
      12,
      {
        onToolEvent: (event: any) => {
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
    if (decision?.mode === "change") {
      isChangeTurn = true;
      isAnswerTurn = false;
      deps.observedFacts.changeFlowEntered = true;
    } else {
      isChangeTurn = false;
      isAnswerTurn = true;
    }
  }

  if (
    shouldStopCommitWorkflowAfterContext({
      workflowKind: deps.taskWorkflowKind,
      commitWorkflowCompleted: deps.commitWorkflowCompleted,
    })
  ) {
    deps.turn.finish();
    const summary = deps.buildSummary({
      success: true,
      steps: contextResult.steps,
      durationMs: Math.round(performance.now() - deps.started),
      promptTokens: contextResult.usage?.promptTokens ?? 0,
      completionTokens: contextResult.usage?.completionTokens ?? 0,
      estimatedCostUsd: contextResult.estimatedCostUsd ?? 0,
    });
    deps.renderSummary(summary);
    void deps.pruneSessionAfterTurn(deps.stateSessionId);
    return {
      result: deps.buildTurnResult(
        "completed",
        summary,
        deps.commitWorkflowOutput || "Created the git commit successfully.",
      ),
      isAnswerTurn,
      isChangeTurn,
    };
  }

  const result = await handleTaskContextOutcome({
    mode: isAnswerTurn ? "answer" : "change",
    contextResult,
    task: deps.request.task,
    questionAnswerReadyReason: deps.questionAnswerReadyReason,
    explorationSummary: deps.questionExploration
      ? summarizeQuestionExploration(deps.questionExploration as never)
      : undefined,
    priorTurnGuidance: deps.priorTurnGuidance ?? undefined,
    planningMaxSteps: deps.planningMaxSteps,
    verificationMaxSteps: deps.verificationMaxSteps,
    compactionMaxSteps: deps.compactionMaxSteps,
    maxSteps: deps.request.maxSteps,
    workflowKind: deps.taskWorkflowKind,
    elapsedMs: () => Math.round(performance.now() - deps.started),
    runPhase: deps.runPhase,
    turn: deps.turn,
    beginImplementationPhase: () => deps.phase.beginImplementation(),
    beginVerificationPhase: () => deps.phase.beginVerification(),
    onImplementationAttempted: () => {
      deps.observedFacts.implementationAttempted = true;
    },
    onVerificationAttempted: () => {
      deps.observedFacts.verificationAttempted = true;
    },
    onChangeFlowEntered: () => {
      deps.observedFacts.changeFlowEntered = true;
    },
    buildSummary: deps.buildSummary,
    buildTurnResult: deps.buildTurnResult,
    renderSummary: deps.renderSummary,
    renderApprovalMessage: deps.renderApprovalMessage,
    renderAssistantError: deps.renderAssistantError,
    persistAssistantTranscript: deps.persistAssistantTranscript,
    pruneAfterTurn: deps.pruneAfterTurn,
    deriveValidationScope: deps.deriveCurrentValidationScope,
    isContextBudgetResult: deps.isContextBudgetResult,
    shouldAttemptVerification: deps.shouldAttemptVerification,
    saveCompactionStarted: deps.saveCompactionStarted,
    saveCompactionCompleted: deps.saveCompactionCompleted,
    updateCompactionMetadata: deps.updateCompactionMetadata,
    parseCompactionReport: deps.parseCompactionReport,
    isContextPressureFailure: deps.isContextPressureFailure,
  });

  return { result, isAnswerTurn, isChangeTurn };
}
