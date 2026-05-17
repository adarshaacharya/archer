export type WorkflowKind = "default" | "commit" | "compact";

export function shouldStopCommitWorkflowAfterContext(input: {
  workflowKind?: WorkflowKind;
  commitWorkflowCompleted: boolean;
}): boolean {
  return input.workflowKind === "commit" && input.commitWorkflowCompleted;
}

export function shouldContinueAfterContextFailure(input: {
  intent: "change" | "question" | "research";
  status: string;
  isContextBudgetResult: boolean;
}): boolean {
  if (input.intent !== "change") {
    return false;
  }

  return input.status !== "completed" && input.isContextBudgetResult;
}

export function shouldAttemptVerification(input: {
  workflowKind?: WorkflowKind;
  implementationStatus: string;
}): boolean {
  if (input.workflowKind === "commit") {
    return false;
  }

  return input.implementationStatus === "completed";
}

export function shouldRetryWithCompactedContext(input: {
  implementationStatus: string;
  hasCompactionReport: boolean;
}): boolean {
  return input.implementationStatus === "failed" && input.hasCompactionReport;
}

export function shouldAttemptRepair(input: {
  workflowKind?: WorkflowKind;
  implementationStatus: string;
  verificationStatus: string | null;
  verificationPassed: boolean | null;
}): boolean {
  if (input.workflowKind === "commit") {
    return false;
  }

  return (
    input.implementationStatus === "completed" &&
    input.verificationStatus === "completed" &&
    input.verificationPassed === false
  );
}
