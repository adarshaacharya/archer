import type { ResolvedLanguageModel } from "@archer/model-providers";
import { resolveLanguageModel } from "@archer/model-providers";

export type ResolvedModel = ResolvedLanguageModel;

export function resolveModel(modelId?: string): ResolvedModel {
  return resolveLanguageModel({ modelId });
}
