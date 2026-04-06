import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ProviderError } from "@xeq/shared";
import { generateText } from "ai";
import type { ModelMessage } from "ai";
import { z } from "zod";

export interface ModelResponse {
  content: string;
  promptTokens?: number;
  completionTokens?: number;
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
