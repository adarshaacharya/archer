import { buildQuestionLimitFinalAnswerPrompt, isMaxStepsResult } from "./execution-policy.js";
import { buildRepairPlanningPrompt } from "./implementation-policy.js";
import type { RuntimePhaseResult, RuntimePhaseRunner } from "./phase-runner.js";
import {
  parseExecutionPlan,
  parseVerificationReport,
  validateCompactionReport,
  validateExecutionPlan,
  validateVerificationReport,
} from "./planning-artifacts.js";
import {
  buildCompactionPrompt,
  buildImplementationPrompt,
  buildPlanningPrompt,
  buildVerificationPrompt,
} from "./task-flow.js";
import {
  planningNeedsRecovery,
  planningSucceeded,
  shouldRepairChangeTurn,
  shouldRetryAfterCompaction,
  verificationPassed,
} from "./turn-guards.js";
import { reduceAnswerTurnState, reduceChangeTurnState } from "./turn-reducer.js";
import { createAnswerTurnState, createChangeTurnState } from "./turn-state.js";
import { buildVerificationScopeInstruction } from "./validation-policy.js";
export type RuntimeSummaryFields = {
  success: boolean;
  steps: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  exploration?: unknown;
};

type UiEvent =
  | { type: "summary"; summary: any }
  | { type: "assistant-message"; message: string }
  | { type: "approval-prompt"; prompt: { message: string } | null };

type TurnLifecycle = {
  finish(): void;
  cancel(): void;
  fail(): void;
  beginPlanning(): void;
  beginImplementation(): void;
  beginVerification(): void;
  beginCompaction(): void;
  beginRepair(): void;
  readonly state: string;
};

export async function handleAnswerContextOutcome<TResult, TSummary>(deps: {
  contextResult: RuntimePhaseResult;
  task: string;
  questionAnswerReadyReason: string | null;
  explorationSummary?: unknown;
  elapsedMs: () => number;
  runPhase: RuntimePhaseRunner;
  turn: Pick<TurnLifecycle, "finish" | "cancel" | "fail">;
  buildSummary: (fields: RuntimeSummaryFields) => TSummary;
  buildTurnResult: (
    status: "completed" | "failed" | "cancelled",
    summary?: TSummary,
    message?: string,
  ) => TResult;
  emitUiEvent: (event: UiEvent) => void;
  persistAssistantTranscript: (message: string) => void | Promise<void>;
  pruneAfterTurn: () => void;
}): Promise<TResult> {
  const {
    contextResult,
    task,
    questionAnswerReadyReason,
    explorationSummary,
    elapsedMs,
    runPhase,
    turn,
    buildSummary,
    buildTurnResult,
    emitUiEvent,
    persistAssistantTranscript,
    pruneAfterTurn,
  } = deps;

  const baseSummary = buildSummary({
    success: contextResult.status === "completed",
    steps: contextResult.steps,
    durationMs: elapsedMs(),
    promptTokens: contextResult.usage?.promptTokens ?? 0,
    completionTokens: contextResult.usage?.completionTokens ?? 0,
    estimatedCostUsd: contextResult.estimatedCostUsd ?? 0,
    ...(explorationSummary ? { exploration: explorationSummary } : {}),
  });

  if (contextResult.status === "completed") {
    const message = contextResult.outputText.trim();
    turn.finish();
    emitUiEvent({ type: "summary", summary: baseSummary });
    pruneAfterTurn();
    return buildTurnResult("completed", baseSummary, message || undefined);
  }

  const partialAnswer = contextResult.outputText.trim();
  if (partialAnswer) {
    const limitReason = contextResult.error
      ? contextResult.error
      : "the runtime stopped before more files could be inspected";
    const message = `${partialAnswer}\n\nNote: ${limitReason}. This answer is based on the useful evidence collected so far.`;
    await persistAssistantTranscript(message);
    turn.finish();
    emitUiEvent({ type: "summary", summary: baseSummary });
    pruneAfterTurn();
    return buildTurnResult("completed", baseSummary, message);
  }

  if (isMaxStepsResult(contextResult) || questionAnswerReadyReason) {
    const finalAnswerResult = await runPhase(
      buildQuestionLimitFinalAnswerPrompt(
        task,
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
        await persistAssistantTranscript(message);
      }
      turn.finish();
      const summary = buildSummary({
        success: true,
        steps: contextResult.steps + finalAnswerResult.steps,
        durationMs: elapsedMs(),
        promptTokens:
          (contextResult.usage?.promptTokens ?? 0) + (finalAnswerResult.usage?.promptTokens ?? 0),
        completionTokens:
          (contextResult.usage?.completionTokens ?? 0) +
          (finalAnswerResult.usage?.completionTokens ?? 0),
        estimatedCostUsd:
          (contextResult.estimatedCostUsd ?? 0) + (finalAnswerResult.estimatedCostUsd ?? 0),
        ...(explorationSummary ? { exploration: explorationSummary } : {}),
      });
      emitUiEvent({ type: "summary", summary });
      pruneAfterTurn();
      return buildTurnResult("completed", summary, message);
    }
  }

  if (contextResult.status === "cancelled") {
    turn.cancel();
    emitUiEvent({ type: "summary", summary: baseSummary });
    return buildTurnResult("cancelled", baseSummary, contextResult.error);
  }

  turn.fail();
  emitUiEvent({
    type: "assistant-message",
    message: contextResult.error
      ? `Research failed: ${contextResult.error}`
      : "Research failed before an answer could be produced.",
  });
  emitUiEvent({ type: "summary", summary: baseSummary });
  pruneAfterTurn();
  return buildTurnResult(
    "failed",
    baseSummary,
    contextResult.error ?? "Research failed before an answer could be produced.",
  );
}

export async function handleTaskContextOutcome<TResult, TSummary>(deps: {
  mode: "answer" | "change";
  contextResult: RuntimePhaseResult;
  task: string;
  questionAnswerReadyReason: string | null;
  explorationSummary?: unknown;
  priorTurnGuidance?: string;
  planningMaxSteps: number;
  verificationMaxSteps: number;
  compactionMaxSteps: number;
  maxSteps: number;
  workflowKind?: "default" | "commit" | "compact";
  elapsedMs: () => number;
  runPhase: RuntimePhaseRunner;
  turn: TurnLifecycle;
  beginImplementationPhase: () => void;
  beginVerificationPhase: () => void;
  onImplementationAttempted: () => void;
  onVerificationAttempted: () => void;
  onChangeFlowEntered: () => void;
  buildSummary: (fields: RuntimeSummaryFields) => TSummary;
  buildTurnResult: (
    status: "completed" | "failed" | "cancelled",
    summary?: TSummary,
    message?: string,
  ) => TResult;
  emitUiEvent: (event: UiEvent) => void;
  persistAssistantTranscript: (message: string) => void | Promise<void>;
  pruneAfterTurn: () => void;
  deriveValidationScope: () => "none" | "targeted" | "standard";
  isContextBudgetResult: (result: RuntimePhaseResult) => boolean;
  shouldAttemptVerification: (input: {
    workflowKind?: "default" | "commit" | "compact";
    implementationStatus: string;
  }) => boolean;
  saveCompactionStarted: () => Promise<void>;
  saveCompactionCompleted: (input: {
    completed: boolean;
    summary: string | null;
    criticalFiles: string[];
    openRisks: string[];
  }) => Promise<void>;
  updateCompactionMetadata: (input: {
    trigger: "context-pressure";
    completed: boolean;
    report: { summary: string; criticalFiles: string[]; openRisks: string[] } | null;
  }) => void;
  parseCompactionReport: (outputText: string) => {
    summary: string;
    criticalFiles: string[];
    openRisks: string[];
  } | null;
  isContextPressureFailure: (result: RuntimePhaseResult) => boolean;
}): Promise<TResult> {
  if (deps.mode === "answer") {
    let answerState = createAnswerTurnState({
      task: deps.task,
      contextResult: deps.contextResult,
      questionAnswerReadyReason: deps.questionAnswerReadyReason,
      explorationSummary: deps.explorationSummary,
    });

    while (true) {
      switch (answerState.phase) {
        case "answering": {
          const baseSummary = deps.buildSummary({
            success: answerState.contextResult.status === "completed",
            steps: answerState.totals.steps,
            durationMs: deps.elapsedMs(),
            promptTokens: answerState.totals.promptTokens,
            completionTokens: answerState.totals.completionTokens,
            estimatedCostUsd: answerState.totals.estimatedCostUsd,
            ...(answerState.explorationSummary
              ? { exploration: answerState.explorationSummary }
              : {}),
          });

          if (answerState.contextResult.status === "completed") {
            const message = answerState.contextResult.outputText.trim();
            answerState = reduceAnswerTurnState(answerState, {
              type: "final-message.set",
              message: message || null,
            });
            answerState = reduceAnswerTurnState(answerState, {
              type: "phase.set",
              phase: "done",
            });
            break;
          }

          const partialAnswer = answerState.contextResult.outputText.trim();
          if (partialAnswer) {
            const limitReason = answerState.contextResult.error
              ? answerState.contextResult.error
              : "the runtime stopped before more files could be inspected";
            answerState = reduceAnswerTurnState(answerState, {
              type: "final-message.set",
              message: `${partialAnswer}\n\nNote: ${limitReason}. This answer is based on the useful evidence collected so far.`,
            });
            answerState = reduceAnswerTurnState(answerState, {
              type: "phase.set",
              phase: "done",
            });
            break;
          }

          if (
            isMaxStepsResult(answerState.contextResult) ||
            answerState.questionAnswerReadyReason
          ) {
            answerState = reduceAnswerTurnState(answerState, {
              type: "phase.set",
              phase: "synthesizing",
            });
            break;
          }

          if (answerState.contextResult.status === "cancelled") {
            answerState = reduceAnswerTurnState(answerState, {
              type: "phase.set",
              phase: "cancelled",
            });
            break;
          }

          deps.turn.fail();
          deps.emitUiEvent({
            type: "assistant-message",
            message: answerState.contextResult.error
              ? `Research failed: ${answerState.contextResult.error}`
              : "Research failed before an answer could be produced.",
          });
          deps.emitUiEvent({ type: "summary", summary: baseSummary });
          deps.pruneAfterTurn();
          return deps.buildTurnResult(
            "failed",
            baseSummary,
            answerState.contextResult.error ??
              "Research failed before an answer could be produced.",
          );
        }
        case "synthesizing": {
          const finalAnswerResult = await deps.runPhase(
            buildQuestionLimitFinalAnswerPrompt(
              deps.task,
              answerState.questionAnswerReadyReason
                ? `The question turn became answer-ready: ${answerState.questionAnswerReadyReason}.`
                : (answerState.contextResult.error ??
                    "The question turn reached its exploration limit."),
            ),
            true,
            24,
            { allowTools: false },
          );
          const finalAnswer = finalAnswerResult.outputText.trim();
          const message = finalAnswer
            ? finalAnswerResult.status === "completed"
              ? finalAnswer
              : `${finalAnswer}\n\nNote: final answer synthesis stopped early after the exploration limit.`
            : null;
          if (message && finalAnswerResult.status !== "completed") {
            await deps.persistAssistantTranscript(message);
          }
          answerState = reduceAnswerTurnState(answerState, {
            type: "synthesis.completed",
            result: finalAnswerResult,
            message,
          });
          answerState = reduceAnswerTurnState(answerState, {
            type: "phase.set",
            phase: message
              ? "done"
              : finalAnswerResult.status === "cancelled"
                ? "cancelled"
                : "blocked",
          });
          if (!message && finalAnswerResult.status !== "cancelled") {
            answerState = reduceAnswerTurnState(answerState, {
              type: "failure.set",
              message: "Final answer synthesis did not produce an answer.",
            });
          }
          break;
        }
        case "done": {
          deps.turn.finish();
          const summary = deps.buildSummary({
            success: true,
            steps: answerState.totals.steps,
            durationMs: deps.elapsedMs(),
            promptTokens: answerState.totals.promptTokens,
            completionTokens: answerState.totals.completionTokens,
            estimatedCostUsd: answerState.totals.estimatedCostUsd,
            ...(answerState.explorationSummary
              ? { exploration: answerState.explorationSummary }
              : {}),
          });
          deps.emitUiEvent({ type: "summary", summary });
          deps.pruneAfterTurn();
          return deps.buildTurnResult("completed", summary, answerState.finalMessage ?? undefined);
        }
        case "cancelled": {
          deps.turn.cancel();
          const summary = deps.buildSummary({
            success: false,
            steps: answerState.totals.steps,
            durationMs: deps.elapsedMs(),
            promptTokens: answerState.totals.promptTokens,
            completionTokens: answerState.totals.completionTokens,
            estimatedCostUsd: answerState.totals.estimatedCostUsd,
            ...(answerState.explorationSummary
              ? { exploration: answerState.explorationSummary }
              : {}),
          });
          deps.emitUiEvent({ type: "summary", summary });
          return deps.buildTurnResult(
            "cancelled",
            summary,
            answerState.failureMessage ?? answerState.contextResult.error,
          );
        }
        case "blocked": {
          deps.turn.fail();
          const summary = deps.buildSummary({
            success: false,
            steps: answerState.totals.steps,
            durationMs: deps.elapsedMs(),
            promptTokens: answerState.totals.promptTokens,
            completionTokens: answerState.totals.completionTokens,
            estimatedCostUsd: answerState.totals.estimatedCostUsd,
            ...(answerState.explorationSummary
              ? { exploration: answerState.explorationSummary }
              : {}),
          });
          deps.emitUiEvent({ type: "summary", summary });
          deps.pruneAfterTurn();
          return deps.buildTurnResult(
            "failed",
            summary,
            answerState.failureMessage ??
              answerState.contextResult.error ??
              "Research failed before an answer could be produced.",
          );
        }
      }
    }
  }

  return handleChangeContextOutcome(deps);
}

export async function handleChangeContextOutcome<TResult, TSummary>(deps: {
  contextResult: RuntimePhaseResult;
  task: string;
  priorTurnGuidance?: string;
  planningMaxSteps: number;
  verificationMaxSteps: number;
  compactionMaxSteps: number;
  maxSteps: number;
  workflowKind?: "default" | "commit" | "compact";
  elapsedMs: () => number;
  runPhase: RuntimePhaseRunner;
  turn: TurnLifecycle;
  beginImplementationPhase: () => void;
  beginVerificationPhase: () => void;
  onImplementationAttempted: () => void;
  onVerificationAttempted: () => void;
  onChangeFlowEntered: () => void;
  buildSummary: (fields: RuntimeSummaryFields) => TSummary;
  buildTurnResult: (
    status: "completed" | "failed" | "cancelled",
    summary?: TSummary,
    message?: string,
  ) => TResult;
  emitUiEvent: (event: UiEvent) => void;
  pruneAfterTurn: () => void;
  deriveValidationScope: () => "none" | "targeted" | "standard";
  isContextBudgetResult: (result: RuntimePhaseResult) => boolean;
  shouldAttemptVerification: (input: {
    workflowKind?: "default" | "commit" | "compact";
    implementationStatus: string;
  }) => boolean;
  saveCompactionStarted: () => Promise<void>;
  saveCompactionCompleted: (input: {
    completed: boolean;
    summary: string | null;
    criticalFiles: string[];
    openRisks: string[];
  }) => Promise<void>;
  updateCompactionMetadata: (input: {
    trigger: "context-pressure";
    completed: boolean;
    report: { summary: string; criticalFiles: string[]; openRisks: string[] } | null;
  }) => void;
  parseCompactionReport: (outputText: string) => {
    summary: string;
    criticalFiles: string[];
    openRisks: string[];
  } | null;
  isContextPressureFailure: (result: RuntimePhaseResult) => boolean;
}): Promise<TResult> {
  const {
    contextResult,
    task,
    priorTurnGuidance,
    planningMaxSteps,
    verificationMaxSteps,
    compactionMaxSteps,
    maxSteps,
    workflowKind,
    elapsedMs,
    runPhase,
    turn,
    beginImplementationPhase,
    beginVerificationPhase,
    onImplementationAttempted,
    onVerificationAttempted,
    onChangeFlowEntered,
    buildSummary,
    buildTurnResult,
    emitUiEvent,
    pruneAfterTurn,
    deriveValidationScope,
    shouldAttemptVerification,
    saveCompactionStarted,
    saveCompactionCompleted,
    updateCompactionMetadata,
    parseCompactionReport,
    isContextPressureFailure,
  } = deps;

  if (contextResult.status === "cancelled") {
    turn.cancel();
    const summary = buildSummary({
      success: false,
      steps: contextResult.steps,
      durationMs: elapsedMs(),
      promptTokens: contextResult.usage?.promptTokens ?? 0,
      completionTokens: contextResult.usage?.completionTokens ?? 0,
      estimatedCostUsd: contextResult.estimatedCostUsd ?? 0,
    });
    deps.emitUiEvent({ type: "summary", summary });
    return buildTurnResult("cancelled", summary, contextResult.error);
  }

  if (contextResult.status !== "completed" && !deps.isContextBudgetResult(contextResult)) {
    turn.fail();
    const summary = buildSummary({
      success: false,
      steps: contextResult.steps,
      durationMs: elapsedMs(),
      promptTokens: contextResult.usage?.promptTokens ?? 0,
      completionTokens: contextResult.usage?.completionTokens ?? 0,
      estimatedCostUsd: contextResult.estimatedCostUsd ?? 0,
    });
    deps.emitUiEvent({ type: "summary", summary });
    return buildTurnResult("failed", summary, contextResult.error);
  }

  let changeState = createChangeTurnState({
    task,
    workflowKind,
    contextResult,
  });
  onChangeFlowEntered();

  while (true) {
    switch (changeState.phase) {
      case "planning": {
        turn.beginPlanning();
        let submittedPlan: ReturnType<typeof validateExecutionPlan> = null;
        const planningPrompt = buildPlanningPrompt(
          task,
          changeState.contextSummary,
          priorTurnGuidance,
        );
        let planningResult = await runPhase(planningPrompt, false, planningMaxSteps, {
          onToolEvent: (event) => {
            if (event.phase !== "done" || event.toolName !== "submitPlan") {
              return;
            }
            const validated = validateExecutionPlan(event.output);
            if (validated) {
              submittedPlan = validated;
            }
          },
        });
        let plan =
          submittedPlan ??
          (planningResult.status === "completed"
            ? parseExecutionPlan(planningResult.outputText)
            : null);

        changeState = reduceChangeTurnState(changeState, {
          type: "planning.completed",
          result: planningResult,
          plan,
        });

        if (planningResult.status === "cancelled") {
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "cancelled",
          });
          break;
        }

        if (planningResult.status !== "completed") {
          changeState = reduceChangeTurnState(changeState, {
            type: "failure.set",
            message: planningResult.error ?? "Planning failed.",
          });
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "blocked",
          });
          break;
        }

        if (planningNeedsRecovery(changeState)) {
          changeState = reduceChangeTurnState(changeState, {
            type: "planning.recovery-attempted",
          });
          planningResult = await runPhase(
            [
              "Your previous output was invalid.",
              "Submit a valid plan using the submitPlan tool.",
              "Only fall back to raw JSON if the tool is unavailable.",
              "The plan shape is:",
              "{ goal: string, steps: [{ id: string, title: string, targets: string[], rationale: string, verification: string }] }",
              "Original task:",
              task,
              "Previous invalid output:",
              planningResult.outputText || "(empty)",
            ].join("\n"),
            false,
            Math.max(8, Math.floor(planningMaxSteps / 2)),
            {
              onToolEvent: (event) => {
                if (event.phase !== "done" || event.toolName !== "submitPlan") {
                  return;
                }
                const validated = validateExecutionPlan(event.output);
                if (validated) {
                  submittedPlan = validated;
                }
              },
            },
          );
          plan =
            submittedPlan ??
            (planningResult.status === "completed"
              ? parseExecutionPlan(planningResult.outputText)
              : null);
          changeState = reduceChangeTurnState(changeState, {
            type: "planning.completed",
            result: planningResult,
            plan,
          });
        }

        if (!planningSucceeded(changeState)) {
          changeState = reduceChangeTurnState(changeState, {
            type: "failure.set",
            message: "Planning output was invalid.",
          });
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: planningResult.status === "cancelled" ? "cancelled" : "blocked",
          });
          break;
        }

        deps.emitUiEvent({
          type: "approval-prompt",
          prompt: { message: "Plan prepared. Starting implementation..." },
        });
        changeState = reduceChangeTurnState(changeState, {
          type: "phase.set",
          phase: "implementing",
        });
        break;
      }
      case "implementing": {
        if (!changeState.plan) {
          changeState = reduceChangeTurnState(changeState, {
            type: "failure.set",
            message: "Cannot implement without a plan.",
          });
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "blocked",
          });
          break;
        }

        turn.beginImplementation();
        beginImplementationPhase();
        onImplementationAttempted();
        const implementationPrompt = buildImplementationPrompt(
          task,
          [JSON.stringify(changeState.plan, null, 2), changeState.implementationPromptAddendum]
            .filter(Boolean)
            .join("\n\n"),
        );
        const implementationResult = await runPhase(implementationPrompt, true, maxSteps);
        changeState = reduceChangeTurnState(changeState, {
          type: "implementation.completed",
          result: implementationResult,
        });

        if (implementationResult.status === "cancelled") {
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "cancelled",
          });
          break;
        }

        if (isContextPressureFailure(implementationResult)) {
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "compacting",
          });
          break;
        }

        if (
          shouldAttemptVerification({
            workflowKind,
            implementationStatus: implementationResult.status,
          })
        ) {
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "verifying",
          });
          break;
        }

        if (implementationResult.status === "completed") {
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "done",
          });
        } else {
          changeState = reduceChangeTurnState(changeState, {
            type: "failure.set",
            message: implementationResult.error ?? "Implementation failed.",
          });
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "blocked",
          });
        }
        break;
      }
      case "verifying": {
        if (!changeState.plan || !changeState.implementationResult) {
          changeState = reduceChangeTurnState(changeState, {
            type: "failure.set",
            message: "Verification requires a completed implementation pass.",
          });
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "blocked",
          });
          break;
        }

        onVerificationAttempted();
        turn.beginVerification();
        beginVerificationPhase();
        deps.emitUiEvent({
          type: "approval-prompt",
          prompt: { message: "Implementation completed. Running verification..." },
        });
        let submittedVerificationReport: ReturnType<typeof validateVerificationReport> = null;
        const verificationResult = await runPhase(
          buildVerificationPrompt(
            task,
            JSON.stringify(changeState.plan, null, 2),
            buildVerificationScopeInstruction(deriveValidationScope()),
          ),
          false,
          verificationMaxSteps,
          {
            onToolEvent: (event) => {
              if (event.phase !== "done" || event.toolName !== "submitVerificationReport") {
                return;
              }
              const validated = validateVerificationReport(event.output);
              if (validated) {
                submittedVerificationReport = validated;
              }
            },
          },
        );
        const verificationReport =
          submittedVerificationReport ??
          (verificationResult.status === "completed"
            ? parseVerificationReport(verificationResult.outputText)
            : null);
        changeState = reduceChangeTurnState(changeState, {
          type: "verification.completed",
          result: verificationResult,
          report: verificationReport,
        });

        if (verificationResult.status === "cancelled") {
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "cancelled",
          });
          break;
        }

        if (shouldRepairChangeTurn(changeState)) {
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "repairing",
          });
          break;
        }

        const verifiedImplementationResult = changeState.implementationResult;
        if (
          verifiedImplementationResult?.status === "completed" &&
          verificationPassed(changeState)
        ) {
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "done",
          });
        } else {
          changeState = reduceChangeTurnState(changeState, {
            type: "failure.set",
            message: verificationResult.error ?? "Verification did not produce a passing result.",
          });
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "blocked",
          });
        }
        break;
      }
      case "repairing": {
        if (!changeState.plan || !changeState.verificationReport) {
          changeState = reduceChangeTurnState(changeState, {
            type: "failure.set",
            message: "Repair requested without a verification report.",
          });
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "blocked",
          });
          break;
        }

        turn.beginRepair();
        const repairPlanning = await runPhase(
          buildRepairPlanningPrompt(
            task,
            JSON.stringify(changeState.plan),
            JSON.stringify(changeState.verificationReport),
          ),
          false,
          Math.max(8, Math.floor(planningMaxSteps / 2)),
        );
        const repairedPlan =
          repairPlanning.status === "completed"
            ? parseExecutionPlan(repairPlanning.outputText)
            : null;
        changeState = reduceChangeTurnState(changeState, {
          type: "repair.completed",
          result: repairPlanning,
          plan: repairedPlan,
        });

        if (repairPlanning.status === "cancelled") {
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "cancelled",
          });
          break;
        }

        if (!repairedPlan) {
          changeState = reduceChangeTurnState(changeState, {
            type: "failure.set",
            message: repairPlanning.error ?? "Repair plan was invalid.",
          });
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "blocked",
          });
          break;
        }

        deps.emitUiEvent({
          type: "approval-prompt",
          prompt: { message: "Verification failed. Applying repair plan..." },
        });
        changeState = reduceChangeTurnState(changeState, {
          type: "implementation.addendum.set",
          addendum:
            "Apply this as a targeted repair pass using verification findings from the previous attempt.",
        });
        changeState = reduceChangeTurnState(changeState, {
          type: "phase.set",
          phase: "implementing",
        });
        break;
      }
      case "compacting": {
        if (!changeState.plan || !changeState.implementationResult) {
          changeState = reduceChangeTurnState(changeState, {
            type: "failure.set",
            message: "Compaction requires an implementation attempt.",
          });
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "blocked",
          });
          break;
        }

        turn.beginCompaction();
        await saveCompactionStarted();
        let submittedCompactionReport: ReturnType<typeof validateCompactionReport> = null;
        const compactRun = await runPhase(
          buildCompactionPrompt(
            task,
            JSON.stringify(changeState.plan, null, 2),
            changeState.implementationResult.outputText,
          ),
          false,
          compactionMaxSteps,
          {
            onToolEvent: (event) => {
              if (event.phase !== "done" || event.toolName !== "submitCompactionReport") {
                return;
              }
              const validated = validateCompactionReport(event.output);
              if (validated) {
                submittedCompactionReport = validated;
              }
            },
          },
        );
        const compacted =
          submittedCompactionReport ??
          (compactRun.status === "completed" ? parseCompactionReport(compactRun.outputText) : null);
        updateCompactionMetadata({
          trigger: "context-pressure",
          completed: compactRun.status === "completed",
          report: compacted,
        });
        await saveCompactionCompleted({
          completed: compacted !== null,
          summary: compacted?.summary ?? null,
          criticalFiles: compacted?.criticalFiles ?? [],
          openRisks: compacted?.openRisks ?? [],
        });
        changeState = reduceChangeTurnState(changeState, {
          type: "compaction.completed",
          result: compactRun,
          report: compacted,
        });

        if (compactRun.status === "cancelled") {
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "cancelled",
          });
          break;
        }

        if (shouldRetryAfterCompaction(changeState)) {
          deps.emitUiEvent({
            type: "approval-prompt",
            prompt: { message: "Context pressure detected. Retrying with compacted context..." },
          });
          changeState = reduceChangeTurnState(changeState, {
            type: "implementation.addendum.set",
            addendum: [
              "Compacted continuation brief:",
              JSON.stringify(changeState.compactionReport, null, 2),
            ].join("\n"),
          });
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "implementing",
          });
        } else {
          changeState = reduceChangeTurnState(changeState, {
            type: "failure.set",
            message:
              changeState.implementationResult?.error ??
              "Context pressure retry could not continue.",
          });
          changeState = reduceChangeTurnState(changeState, {
            type: "phase.set",
            phase: "blocked",
          });
        }
        break;
      }
      case "done": {
        turn.finish();
        const summary = buildSummary({
          success: true,
          steps: changeState.totals.steps,
          durationMs: elapsedMs(),
          promptTokens: changeState.totals.promptTokens,
          completionTokens: changeState.totals.completionTokens,
          estimatedCostUsd: changeState.totals.estimatedCostUsd,
        });
        deps.emitUiEvent({ type: "summary", summary });
        pruneAfterTurn();
        return buildTurnResult("completed", summary);
      }
      case "cancelled": {
        turn.cancel();
        const summary = buildSummary({
          success: false,
          steps: changeState.totals.steps,
          durationMs: elapsedMs(),
          promptTokens: changeState.totals.promptTokens,
          completionTokens: changeState.totals.completionTokens,
          estimatedCostUsd: changeState.totals.estimatedCostUsd,
        });
        deps.emitUiEvent({ type: "summary", summary });
        return buildTurnResult("cancelled", summary, changeState.failureMessage ?? undefined);
      }
      case "blocked": {
        turn.fail();
        const summary = buildSummary({
          success: false,
          steps: changeState.totals.steps,
          durationMs: elapsedMs(),
          promptTokens: changeState.totals.promptTokens,
          completionTokens: changeState.totals.completionTokens,
          estimatedCostUsd: changeState.totals.estimatedCostUsd,
        });
        deps.emitUiEvent({ type: "summary", summary });
        pruneAfterTurn();
        return buildTurnResult(
          "failed",
          summary,
          changeState.failureMessage ??
            changeState.implementationResult?.error ??
            contextResult.error ??
            "Change turn failed.",
        );
      }
      default: {
        changeState = reduceChangeTurnState(changeState, {
          type: "failure.set",
          message: `Unhandled change turn phase: ${changeState.phase}`,
        });
        changeState = reduceChangeTurnState(changeState, {
          type: "phase.set",
          phase: "blocked",
        });
      }
    }
  }
}
