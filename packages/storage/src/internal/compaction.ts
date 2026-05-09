import type { ModelMessage } from "ai";

export const DEFAULT_PRUNE_PROTECT_TOKENS = 10_000;
export const DEFAULT_PRUNE_MINIMUM_TOKENS = 5_000;
export const DEFAULT_RECENT_ASSISTANT_MESSAGES_TO_KEEP = 2;
export const PRUNED_TRANSCRIPT_PREFIX = "[pruned-transcript]";
export const COMPACT_ARTIFACT_KIND = "compact_artifact";
export const COMPACTION_EVENT_KIND = "compaction_event";

export const MODEL_MESSAGE_PROTECT_TOKENS = 12_500;
export const MODEL_MESSAGE_MINIMUM_PRUNE_TOKENS = 5_000;
export const MODEL_MESSAGE_RECENT_TO_KEEP = 12;

export function summarizeTranscript(content: string): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 1200) {
    return cleaned;
  }
  return `${cleaned.slice(0, 1200)}...`;
}

export function extractLikelyFiles(content: string): string[] {
  const matches = content.match(/\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\b/g) ?? [];
  return Array.from(new Set(matches)).filter((value) => /[/.]/.test(value));
}

export function extractLikelyRisks(content: string): string[] {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const riskLines = lines.filter((line) =>
    /(fail|error|risk|todo|follow-up|follow up|unknown|uncertain|blocked|warning)/i.test(line),
  );
  return Array.from(
    new Set(riskLines.map((line) => (line.length > 220 ? `${line.slice(0, 220)}...` : line))),
  );
}

export function estimateModelMessageTokens(message: ModelMessage): number {
  return estimateTextTokens(modelMessageToText(message));
}

export function modelMessageToText(message: ModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  try {
    return JSON.stringify(message.content);
  } catch {
    return String(message.content);
  }
}

export function estimateTextTokens(text: string): number {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }

  return Math.ceil(normalized.length / 4);
}
