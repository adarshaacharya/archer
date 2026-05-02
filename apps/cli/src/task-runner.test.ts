import { describe, expect, it } from "bun:test";
import { buildPriorTurnPlanningGuidance } from "./task-runner.js";

describe("buildPriorTurnPlanningGuidance", () => {
  it("summarizes recent failed turns for planning", () => {
    const guidance = buildPriorTurnPlanningGuidance([
      {
        status: "failed",
        task: "fix lint errors in cli",
        summary: { steps: 52, durationMs: 4200 },
        message: "Run exceeded maxSteps=256",
      },
    ]);

    expect(guidance).toContain("Prior failed turn");
    expect(guidance).toContain("fix lint errors in cli");
    expect(guidance).toContain("steps=52");
    expect(guidance).toContain("message=Run exceeded maxSteps=256");
  });

  it("adds a caution for repeated step-heavy turns", () => {
    const guidance = buildPriorTurnPlanningGuidance([
      {
        status: "completed",
        task: "task one",
        summary: { steps: 45 },
      },
      {
        status: "completed",
        task: "task two",
        summary: { steps: 44 },
      },
    ]);

    expect(guidance).toContain("Recent turns were step-heavy");
  });
});
