import { describe, expect, test } from "bun:test";
import { createChangeTurnState, mergeChangeTurnTotals, runtimePhaseTotals } from "./turn-state.js";

describe("turn-state", () => {
  test("initializes change turn state from context result", () => {
    const state = createChangeTurnState({
      task: "fix bug",
      workflowKind: "default",
      contextResult: {
        status: "completed",
        steps: 3,
        outputText: "context summary",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        estimatedCostUsd: 0.02,
      },
    });

    expect(state.phase).toBe("planning");
    expect(state.contextSummary).toBe("context summary");
    expect(state.totals.steps).toBe(3);
    expect(state.totals.totalTokens).toBe(15);
  });

  test("merges runtime totals", () => {
    expect(
      mergeChangeTurnTotals(
        runtimePhaseTotals({
          status: "completed",
          steps: 2,
          outputText: "",
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
          estimatedCostUsd: 0.1,
        }),
        runtimePhaseTotals({
          status: "completed",
          steps: 4,
          outputText: "",
          usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 },
          estimatedCostUsd: 0.2,
        }),
      ),
    ).toEqual({
      steps: 6,
      promptTokens: 4,
      completionTokens: 7,
      totalTokens: 11,
      estimatedCostUsd: 0.30000000000000004,
    });
  });
});
