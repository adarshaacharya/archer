export type ModelCostRates = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  experimentalOver200K?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
};

export type ModelPricing = {
  provider: string;
  modelId: string;
  cost: ModelCostRates;
};

export type UsageTokens = {
  promptTokens: number;
  completionTokens: number;
};

const MODEL_COSTS: Record<string, Record<string, ModelCostRates>> = {
  openai: {
    "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.08 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1 },
    "gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025 },
    "gpt-5.2": { input: 1.75, output: 14, cacheRead: 0.175 },
    "gpt-5.4": {
      input: 2.5,
      output: 15,
      cacheRead: 0.25,
      experimentalOver200K: {
        input: 5,
        output: 22.5,
        cacheRead: 0.5,
      },
    },
    "gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075 },
    "gpt-5.4-nano": { input: 0.2, output: 1.25, cacheRead: 0.02 },
  },
  anthropic: {
    "claude-3-5-sonnet-latest": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-3-5-haiku-latest": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    "claude-3-7-sonnet-latest": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  gemini: {
    "gemini-2.0-flash": { input: 0.1, output: 0.4, cacheRead: 0.025 },
    "gemini-1.5-flash": { input: 0.075, output: 0.3, cacheRead: 0.01875 },
    "gemini-1.5-pro": { input: 1.25, output: 5, cacheRead: 0.3125 },
  },
};

function normalizeProvider(provider: string): string {
  const value = provider.trim().toLowerCase();
  if (value === "google") return "gemini";
  if (value === "claude") return "anthropic";
  if (value === "codex") return "openai";
  return value;
}

function normalizeModelId(provider: string, modelId: string): string {
  const value = modelId.trim();
  if (provider === "openai") return value.replace(/^openai\//, "");
  if (provider === "anthropic") return value.replace(/^anthropic\//, "");
  if (provider === "gemini") return value.replace(/^(google|gemini)\//, "");
  return value;
}

function cloneCostRates(cost: ModelCostRates): ModelCostRates {
  return {
    input: cost.input,
    output: cost.output,
    cacheRead: cost.cacheRead,
    cacheWrite: cost.cacheWrite,
    experimentalOver200K: cost.experimentalOver200K
      ? {
          input: cost.experimentalOver200K.input,
          output: cost.experimentalOver200K.output,
          cacheRead: cost.experimentalOver200K.cacheRead,
          cacheWrite: cost.experimentalOver200K.cacheWrite,
        }
      : undefined,
  };
}

export function resolveModelPricing(input: {
  provider: string;
  modelId: string;
}): ModelPricing | undefined {
  const provider = normalizeProvider(input.provider);
  const modelId = normalizeModelId(provider, input.modelId);

  const directMatch = MODEL_COSTS[provider]?.[modelId];
  if (directMatch) {
    return { provider, modelId, cost: cloneCostRates(directMatch) };
  }

  if (provider === "openrouter") {
    const [routeProvider, ...rest] = modelId.split("/");
    if (!routeProvider) return undefined;
    const routedModelId = rest.join("/");
    const routedProvider = normalizeProvider(routeProvider);
    const routedMatch = MODEL_COSTS[routedProvider]?.[routedModelId];
    if (routedMatch) {
      return {
        provider: routedProvider,
        modelId: routedModelId,
        cost: cloneCostRates(routedMatch),
      };
    }
  }

  return undefined;
}

export function estimateUsageCost(input: {
  pricing?: ModelPricing;
  usage: UsageTokens;
}): number {
  const cost = input.pricing?.cost;
  if (!cost) return 0;

  return (
    (input.usage.promptTokens * cost.input + input.usage.completionTokens * cost.output) / 1_000_000
  );
}
