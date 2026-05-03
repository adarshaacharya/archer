import { describe, expect, it } from "bun:test";
import { createSpawnSubagentTool } from "./subagentTools.js";

describe("createSpawnSubagentTool", () => {
  it("passes the parsed input to the executor and returns the result", async () => {
    const tool = createSpawnSubagentTool(async (input) => {
      return {
        subagentId: "sub-123",
        status: "completed",
        summary: `handled ${input.kind}`,
        findings: [`scope=${input.scope.type}`],
        citations: [],
        artifacts: [],
        trace: {
          parentTurnId: input.parentTurnId ?? "parent",
          childTurnId: "sub-123",
          kind: input.kind,
          startedAt: "2025-01-01T00:00:00.000Z",
          finishedAt: "2025-01-01T00:00:01.000Z",
        },
      };
    });

    const result = await tool.execute?.(
      {
        kind: "research",
        prompt: "find the answer",
        scope: { type: "web", urls: ["https://example.com"], domains: [] },
      },
      { toolCallId: "test", messages: [] },
    );

    expect(result).toEqual({
      subagentId: "sub-123",
      status: "completed",
      summary: "handled research",
      findings: ["scope=web"],
      citations: [],
      artifacts: [],
      trace: {
        parentTurnId: "parent",
        childTurnId: "sub-123",
        kind: "research",
        startedAt: "2025-01-01T00:00:00.000Z",
        finishedAt: "2025-01-01T00:00:01.000Z",
      },
    });
  });
});
