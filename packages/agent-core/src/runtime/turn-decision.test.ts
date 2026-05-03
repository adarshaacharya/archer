import { describe, expect, it } from "bun:test";
import { parseTurnDecision, resolveObservedTurnIntent } from "./turn-decision.js";

describe("parseTurnDecision", () => {
  it("parses valid strict JSON decisions", () => {
    expect(parseTurnDecision('{"mode":"answer","rationale":"inspection only"}')).toEqual({
      mode: "answer",
      rationale: "inspection only",
    });
  });

  it("returns null for invalid payloads", () => {
    expect(parseTurnDecision("not json")).toBeNull();
    expect(parseTurnDecision('{"mode":"other","rationale":"x"}')).toBeNull();
  });
});

describe("resolveObservedTurnIntent", () => {
  it("returns change when change activity happened", () => {
    expect(
      resolveObservedTurnIntent(
        {
          changeFlowEntered: false,
          implementationAttempted: true,
          verificationAttempted: false,
        },
        [],
      ),
    ).toBe("change");
  });

  it("returns question when no change activity happened", () => {
    expect(
      resolveObservedTurnIntent(
        {
          changeFlowEntered: false,
          implementationAttempted: false,
          verificationAttempted: false,
        },
        [],
      ),
    ).toBe("question");
  });
});
