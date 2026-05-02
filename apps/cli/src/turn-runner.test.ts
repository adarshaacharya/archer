import { describe, expect, it } from "bun:test";
import { deriveCompactionPolicy, routeInputWithHistory } from "./turn-runner.js";

describe("routeInputWithHistory", () => {
  it("reuses the last meaningful intent for continuation-style ambiguous input", () => {
    const routed = routeInputWithHistory("continue with that", [
      { intent: "research", status: "completed", task: "inspect current auth flow" },
    ]);

    expect(routed).toEqual({
      intent: "research",
      task: "continue with that",
    });
  });

  it("keeps explicit questions as questions", () => {
    const routed = routeInputWithHistory("why is this failing?", [
      { intent: "change", status: "failed", task: "fix broken tests" },
    ]);

    expect(routed.intent).toBe("question");
  });
});

describe("deriveCompactionPolicy", () => {
  it("tightens thresholds after repeated failed or cancelled turns", () => {
    const policy = deriveCompactionPolicy([
      { status: "failed", summary: null },
      { status: "cancelled", summary: null },
    ]);

    expect(policy).toEqual({
      protectTokens: 10_000,
      prunableTokens: 5_000,
    });
  });

  it("keeps default thresholds for normal recent turns", () => {
    const policy = deriveCompactionPolicy([
      { status: "completed", summary: { steps: 12 } },
      { status: "completed", summary: { steps: 18 } },
    ]);

    expect(policy).toEqual({
      protectTokens: 12_500,
      prunableTokens: 6_250,
    });
  });
});
