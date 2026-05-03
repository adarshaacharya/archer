import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { getTurnResults } from "@xeq/storage";
import { starterEvalScenarios } from "./scenarios.js";
import {
  type EvalRunSummary,
  EvalRunSummarySchema,
  type EvalScenario,
  EvalScenarioSchema,
} from "./schema.js";
import { scoreEvalRun } from "./score.js";

type EvalFixture = {
  scenario: EvalScenario;
  run: EvalRunSummary;
};

type PersistedTurnLike = {
  status?: unknown;
  task?: unknown;
  message?: unknown;
  summary?: unknown;
};

type EvalResult = {
  scenarioId: string;
  title: string;
  passed: boolean;
  score: number;
  findings: string[];
};

function parseArgs(argv: string[]) {
  const args = new Set<string>();
  let fixturePath: string | null = null;
  let scenarioId: string | null = null;
  let sessionId: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (typeof value !== "string") {
      continue;
    }
    if (value === "--fixture") {
      fixturePath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (value === "--scenario") {
      scenarioId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (value === "--session") {
      sessionId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    args.add(value);
  }

  return {
    fixturePath,
    scenarioId,
    sessionId,
    help: args.has("--help") || args.has("-h"),
  };
}

function printHelp() {
  console.log("Usage: bun run --filter @xeq/evals evals [--fixture path] [--scenario id]");
  console.log("");
  console.log("Without --fixture, runs starter scenarios against built-in example summaries.");
  console.log("With --session, loads persisted turn results from xeq storage for a session id.");
  console.log("With --fixture, expects a JSON object or array of objects shaped like:");
  console.log('{ "scenario": { ... }, "run": { ... } }');
}

function getExampleRunSummaries(): Record<string, EvalRunSummary> {
  return {
    "create-file-missing-dir": {
      status: "completed",
      steps: 7,
      approvalCount: 1,
      fileReadCount: 3,
      changedPaths: ["lib/date.ts"],
      toolNames: ["createDirectory", "preparePatch"],
      finalMessage: "Created lib/date.ts.",
    },
    "edit-existing-file": {
      status: "completed",
      steps: 6,
      approvalCount: 1,
      fileReadCount: 4,
      changedPaths: ["src/date.ts"],
      toolNames: ["readFile", "preparePatch"],
      finalMessage: "Updated the date helper with minimal churn.",
    },
    "question-implementation-location": {
      status: "completed",
      steps: 4,
      approvalCount: 0,
      fileReadCount: 3,
      changedPaths: [],
      toolNames: ["listFiles", "readFile"],
      finalMessage: "Turn routing is implemented in apps/cli/src/task-runner.ts.",
    },
  };
}

function createStarterFixtures(scenarioId: string | null): EvalFixture[] {
  const exampleRuns = getExampleRunSummaries();
  return starterEvalScenarios
    .filter((scenario) => (scenarioId ? scenario.id === scenarioId : true))
    .map((scenario) => ({
      scenario,
      run: exampleRuns[scenario.id] ?? {
        status: "unknown",
        steps: 0,
        approvalCount: 0,
        fileReadCount: 0,
        changedPaths: [],
        toolNames: [],
        finalMessage: "",
      },
    }));
}

async function loadFixturesFromFile(
  filePath: string,
  scenarioId: string | null,
): Promise<EvalFixture[]> {
  const resolvedPath = resolve(filePath);
  const raw = await readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const items = Array.isArray(parsed) ? parsed : [parsed];

  return items
    .map((item) => {
      const object = item as { scenario?: unknown; run?: unknown };
      return {
        scenario: EvalScenarioSchema.parse(object.scenario),
        run: EvalRunSummarySchema.parse(object.run),
      };
    })
    .filter((fixture) => (scenarioId ? fixture.scenario.id === scenarioId : true));
}

export function persistedTurnToEvalRunSummary(turn: PersistedTurnLike): EvalRunSummary {
  const summary =
    typeof turn.summary === "object" && turn.summary !== null
      ? (turn.summary as {
          steps?: unknown;
          evalMetrics?: {
            approvalCount?: unknown;
            fileReadCount?: unknown;
            changedPaths?: unknown;
            toolNames?: unknown;
            finalMessage?: unknown;
          };
        })
      : null;
  const evalMetrics = summary?.evalMetrics;

  return EvalRunSummarySchema.parse({
    status: typeof turn.status === "string" ? turn.status : "unknown",
    steps: typeof summary?.steps === "number" ? summary.steps : 0,
    approvalCount: typeof evalMetrics?.approvalCount === "number" ? evalMetrics.approvalCount : 0,
    fileReadCount: typeof evalMetrics?.fileReadCount === "number" ? evalMetrics.fileReadCount : 0,
    changedPaths: Array.isArray(evalMetrics?.changedPaths) ? evalMetrics.changedPaths : [],
    toolNames: Array.isArray(evalMetrics?.toolNames) ? evalMetrics.toolNames : [],
    finalMessage:
      typeof evalMetrics?.finalMessage === "string"
        ? evalMetrics.finalMessage
        : typeof turn.message === "string"
          ? turn.message
          : "",
  });
}

async function loadFixturesFromSession(
  sessionId: string,
  scenarioId: string | null,
): Promise<EvalFixture[]> {
  const turns = await getTurnResults(sessionId);
  return turns
    .map((turn) => {
      const matchingScenario = starterEvalScenarios.find((scenario) => scenario.task === turn.task);
      if (!matchingScenario) {
        return null;
      }

      return {
        scenario: matchingScenario,
        run: persistedTurnToEvalRunSummary(turn),
      };
    })
    .filter((fixture): fixture is EvalFixture => fixture !== null)
    .filter((fixture) => (scenarioId ? fixture.scenario.id === scenarioId : true));
}

function formatFindings(findings: string[]): string {
  if (findings.length === 0) {
    return "none";
  }
  return findings.join("; ");
}

function printResults(sourceLabel: string, results: EvalResult[]) {
  console.log(`Eval source: ${sourceLabel}`);
  console.log("");
  for (const result of results) {
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${result.scenarioId} score=${result.score} title="${result.title}"`,
    );
    console.log(`  findings: ${formatFindings(result.findings)}`);
  }
  console.log("");
  const passedCount = results.filter((result) => result.passed).length;
  const averageScore =
    results.length === 0
      ? 0
      : Math.round(results.reduce((total, item) => total + item.score, 0) / results.length);
  console.log(`Summary: ${passedCount}/${results.length} passed, average score=${averageScore}`);
}

export async function runEvalCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const fixtures = options.fixturePath
    ? await loadFixturesFromFile(options.fixturePath, options.scenarioId)
    : options.sessionId
      ? await loadFixturesFromSession(options.sessionId, options.scenarioId)
      : createStarterFixtures(options.scenarioId);

  if (fixtures.length === 0) {
    const source = options.fixturePath
      ? basename(options.fixturePath)
      : options.sessionId
        ? `session ${options.sessionId}`
        : "starter scenarios";
    console.error(`No eval fixtures found for source: ${source}`);
    return 1;
  }

  const results = fixtures.map((fixture) => {
    const score = scoreEvalRun(fixture);
    return {
      scenarioId: fixture.scenario.id,
      title: fixture.scenario.title,
      passed: score.passed,
      score: score.score,
      findings: score.findings,
    };
  });

  const sourceLabel = options.fixturePath
    ? basename(options.fixturePath)
    : options.sessionId
      ? `session ${options.sessionId}`
      : "built-in starter fixtures";
  printResults(sourceLabel, results);

  return results.every((result) => result.passed) ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await runEvalCli();
  process.exit(exitCode);
}
