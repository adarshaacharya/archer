import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ProviderError } from "@xeq/shared";
import { generateText } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import { z } from "zod";
import { estimateUsageCost, resolveModelPricing, type ModelPricing } from "./model-pricing.js";

export { estimateUsageCost, resolveModelPricing } from "./model-pricing.js";
export type { ModelPricing } from "./model-pricing.js";

export type SupportedProvider = "openrouter" | "openai" | "anthropic" | "gemini";

export interface ResolveModelOptions {
  provider?: string;
  modelId?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ResolvedLanguageModel {
  provider: SupportedProvider;
  modelId: string;
  apiKeyEnvVar: string;
  model: LanguageModel;
  pricing?: ModelPricing;
}

export interface ModelResponse {
  content: string;
  promptTokens?: number;
  completionTokens?: number;
  estimatedCostUsd?: number;
}

export interface ModelDecisionResponse {
  content: string;
  toolCalls: Array<{
    id?: string;
    name: string;
    input: unknown;
  }>;
}

export interface ModelProvider {
  complete(messages: ModelMessage[]): Promise<ModelResponse>;
  decide(messages: ModelMessage[]): Promise<ModelDecisionResponse>;
}

const PROVIDER_ENV_VAR = "XEQ_PROVIDER";
const DEFAULT_PROVIDER: SupportedProvider = "openrouter";

function normalizeProvider(input?: string): SupportedProvider {
  const normalized = input?.trim().toLowerCase();
  if (!normalized) return DEFAULT_PROVIDER;

  if (normalized === "openrouter") return "openrouter";
  if (normalized === "openai" || normalized === "codex") return "openai";
  if (normalized === "anthropic" || normalized === "claude") return "anthropic";
  if (normalized === "gemini" || normalized === "google") return "gemini";

  throw new ProviderError(
    `Unsupported provider: ${input}. Expected one of openrouter, openai, anthropic, gemini.`,
  );
}

function defaultModelId(provider: SupportedProvider): string {
  switch (provider) {
    case "openai":
      return "gpt-4o-mini";
    case "anthropic":
      return "claude-3-5-sonnet-latest";
    case "gemini":
      return "gemini-2.0-flash";
    default:
      return "openai/gpt-4o-mini";
  }
}

function normalizeModelId(provider: SupportedProvider, modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return defaultModelId(provider);

  switch (provider) {
    case "openai":
      return trimmed.replace(/^openai\//, "");
    case "anthropic":
      return trimmed.replace(/^anthropic\//, "");
    case "gemini":
      return trimmed.replace(/^(google|gemini)\//, "");
    default:
      return trimmed;
  }
}

function resolveApiKey(
  provider: SupportedProvider,
  env: NodeJS.ProcessEnv,
): { apiKey: string; envVar: string } {
  switch (provider) {
    case "openai": {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) throw new ProviderError("OPENAI_API_KEY is required when XEQ_PROVIDER=openai");
      return { apiKey, envVar: "OPENAI_API_KEY" };
    }
    case "anthropic": {
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey)
        throw new ProviderError("ANTHROPIC_API_KEY is required when XEQ_PROVIDER=anthropic");
      return { apiKey, envVar: "ANTHROPIC_API_KEY" };
    }
    case "gemini": {
      const apiKey = env.GEMINI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY;
      if (!apiKey)
        throw new ProviderError(
          "GEMINI_API_KEY is required when XEQ_PROVIDER=gemini (GOOGLE_GENERATIVE_AI_API_KEY also works)",
        );
      return {
        apiKey,
        envVar: env.GEMINI_API_KEY ? "GEMINI_API_KEY" : "GOOGLE_GENERATIVE_AI_API_KEY",
      };
    }
    default: {
      const apiKey = env.OPENROUTER_API_KEY;
      if (!apiKey)
        throw new ProviderError("OPENROUTER_API_KEY is required when XEQ_PROVIDER=openrouter");
      return { apiKey, envVar: "OPENROUTER_API_KEY" };
    }
  }
}

export function resolveModelConfig(
  options: ResolveModelOptions = {},
): Omit<ResolvedLanguageModel, "model"> {
  const env = options.env ?? process.env;
  const provider = normalizeProvider(options.provider ?? env[PROVIDER_ENV_VAR]);
  const modelId = normalizeModelId(
    provider,
    options.modelId ?? env.AGENT_MODEL ?? defaultModelId(provider),
  );
  const { envVar: apiKeyEnvVar } = resolveApiKey(provider, env);

  return {
    provider,
    modelId,
    apiKeyEnvVar,
  };
}

export function resolveLanguageModel(options: ResolveModelOptions = {}): ResolvedLanguageModel {
  const env = options.env ?? process.env;
  const config = resolveModelConfig(options);
  const { apiKey } = resolveApiKey(config.provider, env);
  const pricing = resolveModelPricing({ provider: config.provider, modelId: config.modelId });

  switch (config.provider) {
    case "openai":
      return {
        ...config,
        model: createOpenAI({ apiKey })(config.modelId),
        pricing,
      };
    case "anthropic":
      return {
        ...config,
        model: createAnthropic({ apiKey })(config.modelId),
        pricing,
      };
    case "gemini":
      return {
        ...config,
        model: createGoogleGenerativeAI({ apiKey })(config.modelId),
        pricing,
      };
    default: {
      const openrouter = createOpenRouter({ apiKey });
      return {
        ...config,
        model: openrouter.chat(config.modelId),
        pricing,
      };
    }
  }
}

export class OpenRouterProvider implements ModelProvider {
  constructor(
    private readonly model: string,
    private readonly apiKey: string,
  ) {}

  async complete(messages: ModelMessage[]): Promise<ModelResponse> {
    if (!this.apiKey) throw new ProviderError("OPENROUTER_API_KEY is missing");

    const openRouter = createOpenRouter({
      apiKey: this.apiKey,
    });

    try {
      const response = await generateText({
        model: openRouter.chat(this.model),
        messages,
      });

      return {
        content: response.text,
        promptTokens: response.usage?.inputTokens ?? 0,
        completionTokens: response.usage?.outputTokens ?? 0,
        estimatedCostUsd: estimateUsageCost({
          pricing: resolveModelPricing({ provider: "openrouter", modelId: this.model }),
          usage: {
            promptTokens: response.usage?.inputTokens ?? 0,
            completionTokens: response.usage?.outputTokens ?? 0,
          },
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderError(`OpenRouter request failed: ${message}`);
    }
  }

  async decide(messages: ModelMessage[]): Promise<ModelDecisionResponse> {
    if (!this.apiKey) throw new ProviderError("OPENROUTER_API_KEY is missing");

    const openRouter = createOpenRouter({
      apiKey: this.apiKey,
    });

    try {
      const response = await generateText({
        model: openRouter.chat(this.model),
        messages,
        tools: {
          bash: {
            description: "Execute a bash command in the repository workspace",
            inputSchema: z.object({
              command: z.string(),
            }),
          },
        },
      });

      return {
        content: response.text,
        toolCalls: (response.toolCalls ?? []).map((call) => ({
          id: call.toolCallId,
          name: call.toolName,
          input: call.input,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderError(`OpenRouter decision failed: ${message}`);
    }
  }
}
