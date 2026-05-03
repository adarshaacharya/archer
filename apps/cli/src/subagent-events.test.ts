import { describe, expect, it } from "bun:test";
import { formatSubagentRuntimeEvent } from "./subagent-events.js";

describe("formatSubagentRuntimeEvent", () => {
  it("formats background spawn and status events", () => {
    expect(
      formatSubagentRuntimeEvent({
        phase: "done",
        step: 1,
        toolName: "spawnSubagent",
        output: {
          subagentId: "bg-1",
          sessionId: "sess-1",
          status: "running",
          summary: "Background subagent spawned and running.",
          findings: [],
          citations: [],
          artifacts: [],
          trace: {
            parentTurnId: "parent",
            childTurnId: "bg-1",
            kind: "research",
            startedAt: "2025-01-01T00:00:00.000Z",
          },
        },
      }),
    ).toContain("subagent spawn bg-1 running");
  });

  it("formats cancel and await events", () => {
    expect(
      formatSubagentRuntimeEvent({
        phase: "done",
        step: 1,
        toolName: "subagentCancel",
        output: {
          subagentId: "bg-1",
          cancelled: true,
        },
      }),
    ).toBe("subagent cancel bg-1 cancelled");

    expect(
      formatSubagentRuntimeEvent({
        phase: "done",
        step: 1,
        toolName: "subagentAwait",
        output: {
          mode: "allSettled",
          results: [
            { subagentId: "bg-1", status: "done", result: "ok" },
            { subagentId: "bg-2", status: "failed", error: "boom" },
          ],
        },
      }),
    ).toContain("subagent await mode=allSettled count=2");
  });
});
