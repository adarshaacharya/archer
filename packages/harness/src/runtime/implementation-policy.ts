import type { VerificationReport } from "./planning-artifacts.js";

export type UsageSummary = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type PlanningLikeResult = {
  steps: number;
  usage?: UsageSummary;
  estimatedCostUsd?: number;
};

export type ImplementationLikeResult = {
  status: string;
  steps: number;
  outputText: string;
  error?: string;
  usage?: UsageSummary;
  estimatedCostUsd?: number;
};

export type VerificationLikeResult = {
  status: string;
  steps: number;
  outputText: string;
  usage?: UsageSummary;
  estimatedCostUsd?: number;
};

export type ImplementationRunOutcome = {
  implementationResult: ImplementationLikeResult;
  verificationResult: VerificationLikeResult | null;
  verificationReport: VerificationReport | null;
};

export function mergeUsage(
  left: UsageSummary | undefined,
  right: UsageSummary | undefined,
): UsageSummary {
  return {
    promptTokens: (left?.promptTokens ?? 0) + (right?.promptTokens ?? 0),
    completionTokens: (left?.completionTokens ?? 0) + (right?.completionTokens ?? 0),
    totalTokens: (left?.totalTokens ?? 0) + (right?.totalTokens ?? 0),
  };
}

export function accumulatePlanningResult<T extends PlanningLikeResult>(
  base: T,
  extra: {
    steps: number;
    usage?: UsageSummary;
    estimatedCostUsd?: number;
  },
): T {
  return {
    ...base,
    steps: base.steps + extra.steps,
    usage: mergeUsage(base.usage, extra.usage),
    estimatedCostUsd: (base.estimatedCostUsd ?? 0) + (extra.estimatedCostUsd ?? 0),
  } as T;
}

export function shouldRepairImplementationOutcome(outcome: ImplementationRunOutcome): boolean {
  return (
    outcome.implementationResult.status === "completed" &&
    outcome.verificationResult?.status === "completed" &&
    outcome.verificationReport?.passed === false
  );
}

export function didVerificationPass(
  verificationResult: VerificationLikeResult | null,
  verificationReport: VerificationReport | null,
): boolean {
  return verificationResult == null
    ? true
    : verificationResult.status === "completed" && (verificationReport?.passed ?? false);
}

export function buildRepairPlanningPrompt(
  task: string,
  planJson: string,
  reportJson: string,
): string {
  return [
    "Create a repair plan from the failed verification report.",
    "Return strict JSON only:",
    '{ "goal": string, "steps": [{ "id": string, "title": string, "targets": string[], "rationale": string, "verification": string }] }',
    "Original task:",
    task,
    "Current plan:",
    planJson,
    "Verification report:",
    reportJson,
  ].join("\n");
}
