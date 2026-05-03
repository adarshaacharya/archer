import { describe, expect, it } from "bun:test";
import { starterEvalScenarios } from "./scenarios.js";
import { scoreEvalRun } from "./score.js";

function firstScenario() {
  const scenario = starterEvalScenarios[0];
  if (!scenario) {
    throw new Error("expected at least one starter eval scenario");
  }
  return scenario;
}

describe("scoreEvalRun", () => {
  it("passes a clean run for the missing-directory file-creation scenario", () => {
    const scenario = firstScenario();
    const result = scoreEvalRun({
      scenario,
      run: {
        status: "completed",
        steps: 10,
        approvalCount: 1,
        fileReadCount: 4,
        changedPaths: ["lib/date.ts"],
        toolNames: ["createDirectory", "preparePatch"],
        finalMessage: "Added lib/date.ts",
      },
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });

  it("flags missing required tools and excessive reads", () => {
    const scenario = firstScenario();
    const result = scoreEvalRun({
      scenario,
      run: {
        status: "completed",
        steps: 30,
        approvalCount: 3,
        fileReadCount: 12,
        changedPaths: [],
        toolNames: ["listFiles", "grep"],
        finalMessage: "",
      },
    });

    expect(result.passed).toBe(false);
    expect(result.findings.join("\n")).toContain("required tool was not used: createDirectory");
    expect(result.findings.join("\n")).toContain("required changed path missing: lib/date.ts");
    expect(result.score).toBeLessThan(100);
  });
});
