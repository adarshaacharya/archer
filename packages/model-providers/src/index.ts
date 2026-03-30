import { ProviderError } from "@xeq/shared";

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ModelResponse {
  content: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface ModelProvider {
  complete(messages: ModelMessage[]): Promise<ModelResponse>;
}

export class OpenRouterProvider implements ModelProvider {
  constructor(
    private readonly model: string,
    private readonly apiKey: string,
  ) {}

  async complete(_messages: ModelMessage[]): Promise<ModelResponse> {
    if (!this.apiKey) throw new ProviderError("OPENROUTER_API_KEY is missing");

    // Placeholder for AI SDK integration in next step.
    return {
      content: `[stub:${this.model}] Provider wiring pending`,
      promptTokens: 0,
      completionTokens: 0,
    };
  }
}
