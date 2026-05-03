import { didVerificationPass, shouldRepairImplementationOutcome } from "./implementation-policy.js";
import { shouldAttemptRepair, shouldRetryWithCompactedContext } from "./continuation-policy.js";
import type { ChangeTurnState } from "./turn-state.js";

export function planningSucceeded(state: ChangeTurnState): boolean {
  return state.plan !== null;
}

export function planningNeedsRecovery(state: ChangeTurnState): boolean {
  return state.plan === null && !state.planningRecoveryAttempted;
}

export function verificationPassed(state: ChangeTurnState): boolean {
  return didVerificationPass(state.verificationResult, state.verificationReport);
}

export function shouldRetryAfterCompaction(state: ChangeTurnState): boolean {
  return shouldRetryWithCompactedContext({
    implementationStatus: state.implementationResult?.status ?? "failed",
    hasCompactionReport: state.compactionReport !== null,
  });
}

export function shouldRepairChangeTurn(state: ChangeTurnState): boolean {
  if (
    !state.implementationResult ||
    !state.verificationResult ||
    state.repairCount >= 1 ||
    !shouldRepairImplementationOutcome({
      implementationResult: state.implementationResult,
      verificationResult: state.verificationResult,
      verificationReport: state.verificationReport,
    })
  ) {
    return false;
  }

  return shouldAttemptRepair({
    workflowKind: state.workflowKind,
    implementationStatus: state.implementationResult.status,
    verificationStatus: state.verificationResult.status,
    verificationPassed: state.verificationReport?.passed ?? null,
  });
}
