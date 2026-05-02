import { describe, expect, it } from "bun:test";
import { estimateModelMessageTokens, estimateTextTokens } from "./token-estimation.js";

describe("estimateTextTokens", () => {
  it("uses provider-aware divisors", () => {
    const claude = estimateTextTokens({
      text: "a".repeat(360),
      provider: "anthropic",
      modelId: "claude-3-5-sonnet-latest",
    });
    const gemini = estimateTextTokens({
      text: "a".repeat(360),
      provider: "gemini",
      modelId: "gemini-2.0-flash",
    });

    expect(claude).toBeGreaterThan(gemini);
  });
});

describe("estimateModelMessageTokens", () => {
  it("handles string content model messages", () => {
    const tokens = estimateModelMessageTokens({
      message: { role: "user", content: "hello world" },
      provider: "openai",
      modelId: "gpt-4o-mini",
    });

    expect(tokens).toBeGreaterThan(0);
  });
});
