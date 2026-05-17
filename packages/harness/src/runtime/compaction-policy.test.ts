import { describe, expect, test } from "bun:test";
import {
  createCompactionMetadata,
  deriveCompactionPolicy,
  isContextPressureFailure,
  parseCompactionReport,
  recordCompactionAttempt,
} from "./compaction-policy.js";

describe("compaction-policy", () => {
  test("parses compaction report", () => {
    expect(
      parseCompactionReport(
        'x {"summary":"brief","criticalFiles":["a.ts"],"openRisks":["test gap"]}',
      ),
    ).toEqual({
      summary: "brief",
      criticalFiles: ["a.ts"],
      openRisks: ["test gap"],
    });
  });

  test("detects context pressure failure", () => {
    expect(isContextPressureFailure({ status: "failed", error: "prompt too long" })).toBe(true);
    expect(isContextPressureFailure({ status: "completed" })).toBe(false);
  });

  test("derives tighter compaction thresholds for heavy recent turns", () => {
    expect(
      deriveCompactionPolicy([
        { status: "failed", summary: { steps: 52 } },
        { status: "cancelled", summary: { steps: 41 } },
      ]),
    ).toEqual({
      protectTokens: 10_000,
      prunableTokens: 5_000,
    });
  });

  test("records compaction outcome as explicit metadata", () => {
    const initial = createCompactionMetadata({
      protectTokens: 12_500,
      prunableTokens: 6_250,
    });

    expect(
      recordCompactionAttempt(initial, {
        trigger: "context-pressure",
        completed: true,
        report: {
          summary: "brief",
          criticalFiles: ["a.ts"],
          openRisks: ["follow-up test"],
        },
      }),
    ).toEqual({
      policy: {
        protectTokens: 12_500,
        prunableTokens: 6_250,
      },
      attempted: true,
      attempts: 1,
      trigger: "context-pressure",
      status: "succeeded",
      report: {
        summary: "brief",
        criticalFiles: ["a.ts"],
        openRisks: ["follow-up test"],
      },
    });
  });
});
