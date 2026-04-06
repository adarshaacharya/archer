import { createOpenRouter } from "@openrouter/ai-sdk-provider";

export interface ResolvedModel {
  id: string;
  model: any;
}

export function resolveModel(modelId?: string): ResolvedModel {
  const id = modelId ?? process.env.AGENT_MODEL ?? "openai/gpt-4o-mini";
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for OpenHarness runtime");
  }

  const openrouter = createOpenRouter({ apiKey });
  return {
    id,
    model: openrouter.chat(id),
  };
}
