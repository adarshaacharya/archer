import type { WorkflowKind } from "./continuation-policy.js";
import type { RuntimePhaseResult } from "./phase-runner.js";
import type { ExecutionPlan, VerificationReport } from "./planning-artifacts.js";

export type ChangeTurnPhase =
  | "planning"
  | "implementing"
  | "verifying"
  | "repairing"
  | "compacting"
  | "done"
  | "blocked"
  | "cancelled";

export type ChangeTurnCompactionReport = {
  summary: string;
  criticalFiles: string[];
  openRisks: string[];
};

export type AnswerTurnPhase = "answering" | "synthesizing" | "done" | "blocked" | "cancelled";

export type ChangeTurnTotals = {
  steps: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type AnswerTurnState = {
  task: string;
  phase: AnswerTurnPhase;
  contextResult: RuntimePhaseResult;
  questionAnswerReadyReason: string | null;
  explorationSummary?: unknown;
  finalAnswerResult: RuntimePhaseResult | null;
  finalMessage: string | null;
  failureMessage: string | null;
  totals: ChangeTurnTotals;
};

export type ChangeTurnState = {
  task: string;
  workflowKind?: WorkflowKind;
  phase: ChangeTurnPhase;
  contextSummary: string;
  plan: ExecutionPlan | null;
  planningRecoveryAttempted: boolean;
  implementationPromptAddendum: string | null;
  implementationResult: RuntimePhaseResult | null;
  verificationResult: RuntimePhaseResult | null;
  verificationReport: VerificationReport | null;
  compactionReport: ChangeTurnCompactionReport | null;
  repairCount: number;
  failureMessage: string | null;
  totals: ChangeTurnTotals;
};

export function createChangeTurnState(input: {
  task: string;
  workflowKind?: WorkflowKind;
  contextResult: RuntimePhaseResult;
}): ChangeTurnState {
  return {
    task: input.task,
    workflowKind: input.workflowKind,
    phase: "planning",
    contextSummary: input.contextResult.outputText,
    plan: null,
    planningRecoveryAttempted: false,
    implementationPromptAddendum: null,
    implementationResult: null,
    verificationResult: null,
    verificationReport: null,
    compactionReport: null,
    repairCount: 0,
    failureMessage: null,
    totals: runtimePhaseTotals(input.contextResult),
  };
}

export function createAnswerTurnState(input: {
  task: string;
  contextResult: RuntimePhaseResult;
  questionAnswerReadyReason: string | null;
  explorationSummary?: unknown;
}): AnswerTurnState {
  return {
    task: input.task,
    phase: "answering",
    contextResult: input.contextResult,
    questionAnswerReadyReason: input.questionAnswerReadyReason,
    explorationSummary: input.explorationSummary,
    finalAnswerResult: null,
    finalMessage: null,
    failureMessage: null,
    totals: runtimePhaseTotals(input.contextResult),
  };
}

export function runtimePhaseTotals(
  result: RuntimePhaseResult | null | undefined,
): ChangeTurnTotals {
  return {
    steps: result?.steps ?? 0,
    promptTokens: result?.usage?.promptTokens ?? 0,
    completionTokens: result?.usage?.completionTokens ?? 0,
    totalTokens: result?.usage?.totalTokens ?? 0,
    estimatedCostUsd: result?.estimatedCostUsd ?? 0,
  };
}

export function mergeChangeTurnTotals(
  left: ChangeTurnTotals,
  right: ChangeTurnTotals,
): ChangeTurnTotals {
  return {
    steps: left.steps + right.steps,
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    estimatedCostUsd: left.estimatedCostUsd + right.estimatedCostUsd,
  };
}
