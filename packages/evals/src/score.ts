import {
  type EvalRunSummary,
  EvalRunSummarySchema,
  type EvalScenario,
  EvalScenarioSchema,
} from "./schema.js";
import type { EvalScore } from "./schema.js";

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

export function scoreEvalRun(input: {
  scenario: EvalScenario;
  run: EvalRunSummary;
}): EvalScore {
  const scenario = EvalScenarioSchema.parse(input.scenario);
  const run = EvalRunSummarySchema.parse(input.run);
  const findings: string[] = [];
  let score = 100;

  if (scenario.expectations.mustSucceed && run.status !== "completed") {
    findings.push(`run status was ${run.status}, expected completed`);
    score -= 50;
  }

  if (
    typeof scenario.expectations.maxSteps === "number" &&
    run.steps > scenario.expectations.maxSteps
  ) {
    findings.push(`steps=${run.steps} exceeded maxSteps=${scenario.expectations.maxSteps}`);
    score -= 15;
  }

  if (
    typeof scenario.expectations.maxApprovals === "number" &&
    run.approvalCount > scenario.expectations.maxApprovals
  ) {
    findings.push(
      `approvalCount=${run.approvalCount} exceeded maxApprovals=${scenario.expectations.maxApprovals}`,
    );
    score -= 10;
  }

  if (
    typeof scenario.expectations.maxFileReads === "number" &&
    run.fileReadCount > scenario.expectations.maxFileReads
  ) {
    findings.push(
      `fileReadCount=${run.fileReadCount} exceeded maxFileReads=${scenario.expectations.maxFileReads}`,
    );
    score -= 10;
  }

  const tools = new Set(run.toolNames);
  for (const toolName of unique(scenario.expectations.requiredToolNames)) {
    if (!tools.has(toolName)) {
      findings.push(`required tool was not used: ${toolName}`);
      score -= 10;
    }
  }

  for (const toolName of unique(scenario.expectations.forbiddenToolNames)) {
    if (tools.has(toolName)) {
      findings.push(`forbidden tool was used: ${toolName}`);
      score -= 10;
    }
  }

  const changedPaths = new Set(run.changedPaths);
  for (const changedPath of unique(scenario.expectations.requiredChangedPaths)) {
    if (!changedPaths.has(changedPath)) {
      findings.push(`required changed path missing: ${changedPath}`);
      score -= 15;
    }
  }

  const passed = findings.length === 0;
  return {
    passed,
    score: Math.max(0, score),
    findings,
  };
}
