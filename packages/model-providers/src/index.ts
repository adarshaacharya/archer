import { ProviderError } from "@xeq/shared";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import type { ModelMessage as AiModelMessage } from "ai";

export interface ModelResponse {
  content: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface ModelProvider {
  complete(messages: AiModelMessage[]): Promise<ModelResponse>;
}

export class OpenRouterProvider implements ModelProvider {
  constructor(
    private readonly model: string,
    private readonly apiKey: string,
  ) {}

  async complete(messages: AiModelMessage[]): Promise<ModelResponse> {
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
}
