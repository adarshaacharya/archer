import { describe, expect, test } from "bun:test";
import {
  buildQuestionLimitFinalAnswerPrompt,
  expandedContextSteps,
  isContextBudgetResult,
  isMaxStepsResult,
} from "./execution-policy.js";

describe("execution-policy", () => {
  test("detects context budget failure", () => {
    expect(isContextBudgetResult({ status: "failed", error: "Run exceeded maxSteps=32" })).toBe(
      true,
    );
    expect(isContextBudgetResult({ status: "failed", error: "Run cancelled" })).toBe(true);
    expect(isContextBudgetResult({ status: "completed" })).toBe(false);
  });

  test("expands context steps conservatively", () => {
    expect(expandedContextSteps(256, 16)).toBe(64);
    expect(expandedContextSteps(48, 12)).toBe(24);
  });

  test("detects max-steps failures", () => {
    expect(isMaxStepsResult({ status: "failed", error: "Run exceeded maxSteps=24" })).toBe(true);
    expect(isMaxStepsResult({ status: "failed", error: "timeout" })).toBe(false);
  });

  test("builds final-answer fallback prompt", () => {
    const prompt = buildQuestionLimitFinalAnswerPrompt("where is routing", "limit reached");
    expect(prompt).toContain("QUESTION EXPLORATION LIMIT REACHED");
    expect(prompt).toContain("limit reached");
    expect(prompt).toContain("where is routing");
  });
});
