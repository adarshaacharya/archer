import { describe, expect, it } from "bun:test";
import { deriveCompactionPolicy } from "@archer/agent-core";

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
