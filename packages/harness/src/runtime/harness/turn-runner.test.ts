import { describe, expect, it } from "bun:test";
import { HarnessPolicyEngine } from "./policy-engine.js";
import { HarnessToolRouter } from "./tool-router.js";
import { HarnessTurnRunner } from "./turn-runner.js";

describe("HarnessTurnRunner", () => {
  it("returns completed status when model loop returns final output", async () => {
    const router = new HarnessToolRouter(new HarnessPolicyEngine());
    const runner = new HarnessTurnRunner(
      {
        async decide() {
          return { type: "final", text: "done" };
        },
      },
      router,
    );
    const result = await runner.run({
      turnId: "t1",
      sessionId: "s1",
      mode: "change",
      prompt: "implement x",
      cwd: "/tmp",
      maxSteps: 8,
      timeoutMs: 60_000,
    });

    expect(result).toEqual({
      status: "completed",
      outputText: "done",
      steps: 1,
    });
  });

  it("executes tool calls before finalizing", async () => {
    const router = new HarnessToolRouter(new HarnessPolicyEngine());
    router.registerTool("readFile", async () => "file-content");

    let decisionCount = 0;
    const runner = new HarnessTurnRunner(
      {
        async decide(params) {
          decisionCount += 1;
          if (decisionCount === 1) {
            return { type: "tool_call", toolName: "readFile", args: { filePath: "a.ts" } };
          }
          expect(params.state.observations).toHaveLength(1);
          return { type: "final", text: "summarized" };
        },
      },
      router,
    );
    const result = await runner.run({
      turnId: "t1",
      sessionId: "s1",
      mode: "answer",
      prompt: "why",
      cwd: "/tmp",
      maxSteps: 8,
      timeoutMs: 60_000,
    });

    expect(result.status).toBe("completed");
    expect(result.outputText).toBe("summarized");
    expect(result.steps).toBe(2);
  });

  it("returns failed status when model loop throws", async () => {
    const router = new HarnessToolRouter(new HarnessPolicyEngine());
    const runner = new HarnessTurnRunner(
      {
        async decide() {
          throw new Error("boom");
        },
      },
      router,
    );
    const result = await runner.run({
      turnId: "t1",
      sessionId: "s1",
      mode: "answer",
      prompt: "why",
      cwd: "/tmp",
      maxSteps: 8,
      timeoutMs: 60_000,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("boom");
  });
});
