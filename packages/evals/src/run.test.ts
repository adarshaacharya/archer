import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistedTurnToEvalRunSummary, runEvalCli } from "./run.js";

describe("runEvalCli", () => {
  test("maps persisted turn summaries into eval run summaries", () => {
    const summary = persistedTurnToEvalRunSummary({
      status: "completed",
      message: "fallback",
      summary: {
        steps: 9,
        evalMetrics: {
          approvalCount: 2,
          fileReadCount: 3,
          changedPaths: ["lib/date.ts"],
          toolNames: ["createDirectory", "preparePatch"],
          finalMessage: "Created lib/date.ts",
        },
      },
    });

    expect(summary).toEqual({
      status: "completed",
      steps: 9,
      approvalCount: 2,
      fileReadCount: 3,
      changedPaths: ["lib/date.ts"],
      toolNames: ["createDirectory", "preparePatch"],
      finalMessage: "Created lib/date.ts",
    });
  });

  test("returns success for starter fixtures", async () => {
    const exitCode = await runEvalCli([]);
    expect(exitCode).toBe(0);
  });

  test("filters to a single starter scenario", async () => {
    const exitCode = await runEvalCli(["--scenario", "create-file-missing-dir"]);
    expect(exitCode).toBe(0);
  });

  test("returns failure when a fixture run misses expectations", async () => {
    const dir = join(tmpdir(), `archer-evals-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const fixturePath = join(dir, "fixture.json");
    await writeFile(
      fixturePath,
      JSON.stringify(
        {
          scenario: {
            id: "bad-run",
            title: "Bad run",
            task: "Create lib/date.ts",
            tags: [],
            expectations: {
              mustSucceed: true,
              requiredToolNames: ["createDirectory"],
              requiredChangedPaths: ["lib/date.ts"],
            },
          },
          run: {
            status: "failed",
            steps: 2,
            approvalCount: 0,
            fileReadCount: 0,
            changedPaths: [],
            toolNames: ["listFiles"],
            finalMessage: "failed",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const exitCode = await runEvalCli(["--fixture", fixturePath]);
    expect(exitCode).toBe(1);
  });
});
