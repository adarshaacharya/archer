import { describe, expect, it } from "bun:test";
import {
  shouldAttemptRepair,
  shouldAttemptVerification,
  shouldContinueAfterContextFailure,
  shouldRetryWithCompactedContext,
  shouldStopCommitWorkflowAfterContext,
} from "./continuation-policy.js";

describe("continuation-policy", () => {
  it("stops commit workflows once commit completed during context", () => {
    expect(
      shouldStopCommitWorkflowAfterContext({
        workflowKind: "commit",
        commitWorkflowCompleted: true,
      }),
    ).toBe(true);
    expect(
      shouldStopCommitWorkflowAfterContext({
        workflowKind: "default",
        commitWorkflowCompleted: true,
      }),
    ).toBe(false);
  });

  it("continues only change turns after context-budget failure", () => {
    expect(
      shouldContinueAfterContextFailure({
        intent: "change",
        status: "failed",
        isContextBudgetResult: true,
      }),
    ).toBe(true);
    expect(
      shouldContinueAfterContextFailure({
        intent: "question",
        status: "failed",
        isContextBudgetResult: true,
      }),
    ).toBe(false);
  });

  it("skips verification for commit workflow", () => {
    expect(
      shouldAttemptVerification({
        workflowKind: "commit",
        implementationStatus: "completed",
      }),
    ).toBe(false);
    expect(
      shouldAttemptVerification({
        workflowKind: "default",
        implementationStatus: "completed",
      }),
    ).toBe(true);
  });

  it("retries only failed runs when compaction produced a report", () => {
    expect(
      shouldRetryWithCompactedContext({
        implementationStatus: "failed",
        hasCompactionReport: true,
      }),
    ).toBe(true);
    expect(
      shouldRetryWithCompactedContext({
        implementationStatus: "completed",
        hasCompactionReport: true,
      }),
    ).toBe(false);
  });

  it("skips repair for commit workflows and requires failed verification", () => {
    expect(
      shouldAttemptRepair({
        workflowKind: "commit",
        implementationStatus: "completed",
        verificationStatus: "completed",
        verificationPassed: false,
      }),
    ).toBe(false);
    expect(
      shouldAttemptRepair({
        workflowKind: "default",
        implementationStatus: "completed",
        verificationStatus: "completed",
        verificationPassed: false,
      }),
    ).toBe(true);
  });
});
