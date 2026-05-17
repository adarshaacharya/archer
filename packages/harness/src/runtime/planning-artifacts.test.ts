import { describe, expect, test } from "bun:test";
import {
  buildPriorTurnPlanningGuidance,
  parseExecutionPlan,
  parseVerificationReport,
} from "./planning-artifacts.js";

describe("planning-artifacts", () => {
  test("builds prior turn guidance from failed turns", () => {
    const result = buildPriorTurnPlanningGuidance([
      {
        status: "failed",
        task: "fix flaky tests",
        summary: { steps: 52, durationMs: 4200 },
        message: "verification failed",
      },
    ]);

    expect(result).toContain("Prior failed turn on: fix flaky tests");
    expect(result).toContain("steps=52");
    expect(result).toContain("durationMs=4200");
  });

  test("parses execution plan json from mixed output", () => {
    const result = parseExecutionPlan(
      `Plan:\n{"goal":"Ship fix","steps":[{"id":"1","title":"Edit file","targets":["src/a.ts"],"rationale":"needed","verification":"run tests"}]}`,
    );

    expect(result).toEqual({
      goal: "Ship fix",
      steps: [
        {
          id: "1",
          title: "Edit file",
          targets: ["src/a.ts"],
          rationale: "needed",
          verification: "run tests",
        },
      ],
    });
  });

  test("parses verification report json", () => {
    const result = parseVerificationReport(
      `Done\n{"passed":false,"commands":["bun test"],"findings":["1 test failed"]}`,
    );

    expect(result).toEqual({
      passed: false,
      commands: ["bun test"],
      findings: ["1 test failed"],
    });
  });
});
