import { describe, expect, test } from "bun:test";
import {
  accumulatePlanningResult,
  buildRepairPlanningPrompt,
  didVerificationPass,
  mergeUsage,
  shouldRepairImplementationOutcome,
} from "./implementation-policy.js";

describe("implementation-policy", () => {
  test("merges usage summaries", () => {
    expect(
      mergeUsage(
        { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        { promptTokens: 4, completionTokens: 5, totalTokens: 6 },
      ),
    ).toEqual({
      promptTokens: 5,
      completionTokens: 7,
      totalTokens: 9,
    });
  });

  test("accumulates planning results", () => {
    expect(
      accumulatePlanningResult(
        {
          steps: 5,
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
          estimatedCostUsd: 0.1,
        },
        {
          steps: 2,
          usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
          estimatedCostUsd: 0.2,
        },
      ),
    ).toEqual({
      steps: 7,
      usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
      estimatedCostUsd: 0.30000000000000004,
    });
  });

  test("detects repairable outcomes", () => {
    expect(
      shouldRepairImplementationOutcome({
        implementationResult: { status: "completed", steps: 1, outputText: "" },
        verificationResult: { status: "completed", steps: 1, outputText: "" },
        verificationReport: { passed: false, commands: [], findings: [] },
      }),
    ).toBe(true);
  });

  test("computes verification pass status", () => {
    expect(didVerificationPass(null, null)).toBe(true);
    expect(
      didVerificationPass(
        { status: "completed", steps: 1, outputText: "" },
        { passed: true, commands: [], findings: [] },
      ),
    ).toBe(true);
    expect(
      didVerificationPass(
        { status: "completed", steps: 1, outputText: "" },
        { passed: false, commands: [], findings: [] },
      ),
    ).toBe(false);
  });

  test("builds repair planning prompt", () => {
    const prompt = buildRepairPlanningPrompt("fix bug", '{"goal":"x"}', '{"passed":false}');
    expect(prompt).toContain("Create a repair plan");
    expect(prompt).toContain("fix bug");
  });
});
