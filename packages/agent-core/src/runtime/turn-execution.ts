import {
  buildCompactionPrompt,
  buildImplementationPrompt,
  buildPlanningPrompt,
  buildVerificationPrompt,
} from "./task-flow.js";
import { buildQuestionLimitFinalAnswerPrompt, isMaxStepsResult } from "./execution-policy.js";
import {
  buildRepairPlanningPrompt,
  didVerificationPass,
  mergeUsage,
  shouldRepairImplementationOutcome,
} from "./implementation-policy.js";
import { parseExecutionPlan, parseVerificationReport } from "./planning-artifacts.js";
import { shouldRetryWithCompactedContext, shouldAttemptRepair } from "./continuation-policy.js";
import { buildVerificationScopeInstruction } from "./validation-policy.js";
import type { ImplementationRunOutcome } from "./implementation-policy.js";
import type { VerificationReport } from "./planning-artifacts.js";

type Usage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type RuntimePhaseResult = {
  status: string;
  steps: number;
  outputText: string;
  error?: string;
  usage?: Usage;
  estimatedCostUsd?: number;
};

export type RuntimeSummaryFields = {
  success: boolean;
  steps: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  exploration?: unknown;
};

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
  runPhase: (
    prompt: string,
    persistTranscript: boolean,
    maxSteps: number,
    options?: { allowTools?: boolean; instructions?: string },
  ) => Promise<RuntimePhaseResult>;
  turn: Pick<TurnLifecycle, "finish" | "cancel" | "fail">;
  buildSummary: (fields: RuntimeSummaryFields) => TSummary;
  buildTurnResult: (
    status: "completed" | "failed" | "cancelled",
    summary?: TSummary,
    message?: string,
  ) => TResult;
  renderSummary: (summary: TSummary) => void;
  renderAssistantError: (message: string) => void;
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
    renderSummary,
    renderAssistantError,
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
    renderSummary(baseSummary);
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
    renderSummary(baseSummary);
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
      renderSummary(summary);
      pruneAfterTurn();
      return buildTurnResult("completed", summary, message);
    }
  }

  if (contextResult.status === "cancelled") {
    turn.cancel();
    renderSummary(baseSummary);
    return buildTurnResult("cancelled", baseSummary, contextResult.error);
  }

  turn.fail();
  renderAssistantError(
    contextResult.error
      ? `Research failed: ${contextResult.error}`
      : "Research failed before an answer could be produced.",
  );
  renderSummary(baseSummary);
  pruneAfterTurn();
  return buildTurnResult(
    "failed",
    baseSummary,
    contextResult.error ?? "Research failed before an answer could be produced.",
  );
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
  runPhase: (
    prompt: string,
    persistTranscript: boolean,
    maxSteps: number,
    options?: { allowTools?: boolean; instructions?: string },
  ) => Promise<RuntimePhaseResult>;
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
  renderSummary: (summary: TSummary) => void;
  renderApprovalMessage: (message: string) => void;
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
    renderSummary,
    renderApprovalMessage,
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
    renderSummary(summary);
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
    renderSummary(summary);
    return buildTurnResult("failed", summary, contextResult.error);
  }

  turn.beginPlanning();
  const planningPrompt = buildPlanningPrompt(task, contextResult.outputText, priorTurnGuidance);
  let planningResult = await runPhase(planningPrompt, false, planningMaxSteps);
  if (planningResult.status === "cancelled") {
    turn.cancel();
    const summary = buildSummary({
      success: false,
      steps: planningResult.steps,
      durationMs: elapsedMs(),
      promptTokens: planningResult.usage?.promptTokens ?? 0,
      completionTokens: planningResult.usage?.completionTokens ?? 0,
      estimatedCostUsd: planningResult.estimatedCostUsd ?? 0,
    });
    renderSummary(summary);
    return buildTurnResult("cancelled", summary);
  }

  if (planningResult.status !== "completed") {
    turn.fail();
    const summary = buildSummary({
      success: false,
      steps: planningResult.steps,
      durationMs: elapsedMs(),
      promptTokens: planningResult.usage?.promptTokens ?? 0,
      completionTokens: planningResult.usage?.completionTokens ?? 0,
      estimatedCostUsd: planningResult.estimatedCostUsd ?? 0,
    });
    renderSummary(summary);
    return buildTurnResult("failed", summary, planningResult.error);
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
        task,
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
      durationMs: elapsedMs(),
      promptTokens: (contextResult.usage?.promptTokens ?? 0) + (planningResult.usage?.promptTokens ?? 0),
      completionTokens:
        (contextResult.usage?.completionTokens ?? 0) +
        (planningResult.usage?.completionTokens ?? 0),
      estimatedCostUsd:
        (contextResult.estimatedCostUsd ?? 0) + (planningResult.estimatedCostUsd ?? 0),
    });
    renderSummary(summary);
    return buildTurnResult("failed", summary, "Planning output was invalid.");
  }

  renderApprovalMessage("Plan prepared. Starting implementation...");
  onChangeFlowEntered();
  const attemptImplementationAndVerification = async (
    implementationPrompt: string,
  ): Promise<ImplementationRunOutcome> => {
    turn.beginImplementation();
    beginImplementationPhase();
    onImplementationAttempted();
    const implementationResult = await runPhase(implementationPrompt, true, maxSteps);

    let verificationResult: RuntimePhaseResult | null = null;
    let verificationReport: VerificationReport | null = null;

    if (shouldAttemptVerification({ workflowKind, implementationStatus: implementationResult.status })) {
      onVerificationAttempted();
      turn.beginVerification();
      beginVerificationPhase();
      renderApprovalMessage("Implementation completed. Running verification...");
      verificationResult = await runPhase(
        buildVerificationPrompt(
          task,
          JSON.stringify(plan, null, 2),
          buildVerificationScopeInstruction(deriveValidationScope()),
        ),
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
    buildImplementationPrompt(task, JSON.stringify(plan, null, 2)),
  );

  if (isContextPressureFailure(runOutcome.implementationResult)) {
    turn.beginCompaction();
    await saveCompactionStarted();
    const compactRun = await runPhase(
      buildCompactionPrompt(task, JSON.stringify(plan, null, 2), runOutcome.implementationResult.outputText),
      false,
      compactionMaxSteps,
    );
    const compacted =
      compactRun.status === "completed" ? parseCompactionReport(compactRun.outputText) : null;
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

    if (
      shouldRetryWithCompactedContext({
        implementationStatus: runOutcome.implementationResult.status,
        hasCompactionReport: compacted !== null,
      })
    ) {
      renderApprovalMessage("Context pressure detected. Retrying with compacted context...");
      runOutcome = await attemptImplementationAndVerification(
        buildImplementationPrompt(
          task,
          [
            JSON.stringify(plan, null, 2),
            "Compacted continuation brief:",
            JSON.stringify(compacted, null, 2),
          ].join("\n\n"),
        ),
      );
    }

    planningResult = {
      ...planningResult,
      usage: mergeUsage(planningResult.usage, compactRun.usage),
      steps: planningResult.steps + compactRun.steps,
      estimatedCostUsd: (planningResult.estimatedCostUsd ?? 0) + (compactRun.estimatedCostUsd ?? 0),
    };
  }

  const shouldRepair =
    shouldRepairImplementationOutcome(runOutcome) &&
    shouldAttemptRepair({
      workflowKind,
      implementationStatus: runOutcome.implementationResult.status,
      verificationStatus: runOutcome.verificationResult?.status ?? null,
      verificationPassed: runOutcome.verificationReport?.passed ?? null,
    });

  if (shouldRepair) {
    turn.beginRepair();
    const report = runOutcome.verificationReport;
    if (!report) {
      throw new Error("Repair requested without a verification report.");
    }
    const repairPlanning = await runPhase(
      buildRepairPlanningPrompt(task, JSON.stringify(plan), JSON.stringify(report)),
      false,
      Math.max(8, Math.floor(planningMaxSteps / 2)),
    );
    const repairedPlan = parseExecutionPlan(repairPlanning.outputText);
    if (repairPlanning.status === "completed" && repairedPlan) {
      plan = repairedPlan;
      renderApprovalMessage("Verification failed. Applying repair plan...");
      const repairedOutcome = await attemptImplementationAndVerification(
        buildImplementationPrompt(
          task,
          `${JSON.stringify(plan, null, 2)}\n\nApply this as a targeted repair pass using verification findings from the previous attempt.`,
        ),
      );
      runOutcome = repairedOutcome;
      planningResult = {
        ...planningResult,
        usage: mergeUsage(planningResult.usage, repairPlanning.usage),
        steps: planningResult.steps + repairPlanning.steps,
        estimatedCostUsd:
          (planningResult.estimatedCostUsd ?? 0) + (repairPlanning.estimatedCostUsd ?? 0),
      };
    }
  }

  const usage = mergeUsage(
    mergeUsage(mergeUsage(contextResult.usage, planningResult.usage), runOutcome.implementationResult.usage),
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
  const summary = buildSummary({
    success: turn.state === "done",
    steps: runOutcome.implementationResult.steps + (runOutcome.verificationResult?.steps ?? 0),
    durationMs: elapsedMs(),
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    estimatedCostUsd:
      (contextResult.estimatedCostUsd ?? 0) +
      (planningResult.estimatedCostUsd ?? 0) +
      (runOutcome.implementationResult.estimatedCostUsd ?? 0) +
      (runOutcome.verificationResult?.estimatedCostUsd ?? 0),
  });
  renderSummary(summary);
  pruneAfterTurn();
  return buildTurnResult(
    turn.state === "done" ? "completed" : turn.state === "cancelled" ? "cancelled" : "failed",
    summary,
    turn.state === "failed" ? runOutcome.implementationResult.error : undefined,
  );
}
