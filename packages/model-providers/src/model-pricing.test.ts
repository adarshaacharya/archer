import { describe, expect, it } from "bun:test";
import { resolveModelConfig } from "./index.js";
import { resolveModelPricing } from "./model-pricing.js";

describe("resolveModelPricing", () => {
  it("supports DeepSeek V4 models", () => {
    const flash = resolveModelPricing({ provider: "deepseek", modelId: "deepseek-v4-flash" });
    const pro = resolveModelPricing({ provider: "deepseek", modelId: "deepseek-v4-pro" });

    expect(flash?.cost.input).toBe(0.14);
    expect(flash?.cost.cacheRead).toBe(0.028);
    expect(pro?.cost.output).toBe(3.48);
  });
});

describe("resolveModelConfig", () => {
  it("resolves DeepSeek defaults", () => {
    const resolved = resolveModelConfig({
      provider: "deepseek",
      env: { DEEPSEEK_API_KEY: "test-key" },
    });

    expect(resolved).toMatchObject({
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      apiKeyEnvVar: "DEEPSEEK_API_KEY",
    });
  });
});
