import { describe, expect, it } from "bun:test";
import { deriveCompactionPolicy } from "@xeq/agent-core";
import { inferIntentWithHistory } from "./turn-runner.js";

describe("inferIntentWithHistory", () => {
  it("reuses the last meaningful intent for attached follow-up input", () => {
    const intent = inferIntentWithHistory("for auth too", [
      { intent: "research", status: "completed", task: "inspect current auth flow" },
    ]);

    expect(intent).toBe("research");
  });

  it("keeps explicit questions as questions", () => {
    const intent = inferIntentWithHistory("why is this failing?", [
      { intent: "change", status: "failed", task: "fix broken tests" },
    ]);

    expect(intent).toBe("question");
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
