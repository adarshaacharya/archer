import { resolveLanguageModel } from "@xeq/model-providers";
import type { ResolvedLanguageModel } from "@xeq/model-providers";

export type ResolvedModel = ResolvedLanguageModel;

export function resolveModel(modelId?: string): ResolvedModel {
  return resolveLanguageModel({ modelId });
}
