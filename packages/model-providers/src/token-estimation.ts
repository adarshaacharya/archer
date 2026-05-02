import type { ModelMessage } from "ai";
import type { SupportedProvider } from "./index.js";

export function estimateTextTokens(input: {
  text: string;
  provider?: SupportedProvider | null;
  modelId?: string;
}): number {
  const normalized = input.text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }

  const divisor = tokenDivisorForModel(input.provider, input.modelId);
  return Math.ceil(normalized.length / divisor);
}

export function estimateModelMessageTokens(input: {
  message: ModelMessage;
  provider?: SupportedProvider | null;
  modelId?: string;
}): number {
  return estimateTextTokens({
    text: modelMessageToText(input.message),
    provider: input.provider,
    modelId: input.modelId,
  });
}

function modelMessageToText(message: ModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  try {
    return JSON.stringify(message.content);
  } catch {
    return String(message.content);
  }
}

function tokenDivisorForModel(provider?: SupportedProvider | null, modelId?: string): number {
  const normalizedProvider = provider ?? null;
  const normalizedModel = modelId?.toLowerCase() ?? "";

  if (normalizedProvider === "anthropic" || normalizedModel.includes("claude")) {
    return 3.6;
  }

  if (normalizedProvider === "gemini" || normalizedModel.includes("gemini")) {
    return 4.2;
  }

  if (
    normalizedProvider === "openai" ||
    normalizedProvider === "openrouter" ||
    normalizedModel.includes("gpt") ||
    normalizedModel.includes("o1") ||
    normalizedModel.includes("o3") ||
    normalizedModel.includes("o4")
  ) {
    return 4;
  }

  return 4;
}
