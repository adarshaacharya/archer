import type { ModelMessage } from "ai";
import type { CompactContinuationArtifact } from "./artifacts.js";
import {
  estimateModelMessageTokens,
  MODEL_MESSAGE_MINIMUM_PRUNE_TOKENS,
  MODEL_MESSAGE_PROTECT_TOKENS,
  MODEL_MESSAGE_RECENT_TO_KEEP,
} from "./compaction.js";

export function toArtifactSystemMessage(artifact: CompactContinuationArtifact): ModelMessage {
  return {
    role: "system",
    content: [
      "Continuation brief from compacted prior session context:",
      `Summary: ${artifact.summary.trim() || "(none)"}`,
      `Critical files: ${artifact.criticalFiles.length > 0 ? artifact.criticalFiles.join(", ") : "(none)"}`,
      `Open risks: ${artifact.openRisks.length > 0 ? artifact.openRisks.join(" | ") : "(none)"}`,
    ].join("\n"),
  };
}

export function hasArtifactSystemMessage(message: ModelMessage | undefined): boolean {
  return Boolean(
    message?.role === "system" &&
      typeof message.content === "string" &&
      message.content.includes("Continuation brief from compacted prior session context:"),
  );
}

export function computePrunedModelMessages(input: {
  rawMessages: ModelMessage[];
  artifact: CompactContinuationArtifact | null;
  protectTokens?: number;
  minimumPruneTokens?: number;
  keepRecentMessages?: number;
  estimateModelMessageTokens?: (message: ModelMessage) => number;
}): { pruned: boolean; removedCount: number; nextMessages: ModelMessage[] } {
  const protectTokens = input.protectTokens ?? MODEL_MESSAGE_PROTECT_TOKENS;
  const minimumPruneTokens = input.minimumPruneTokens ?? MODEL_MESSAGE_MINIMUM_PRUNE_TOKENS;
  const keepRecentMessages = input.keepRecentMessages ?? MODEL_MESSAGE_RECENT_TO_KEEP;
  const estimateMessageTokens = input.estimateModelMessageTokens ?? estimateModelMessageTokens;

  if (input.rawMessages.length <= keepRecentMessages) {
    return { pruned: false, removedCount: 0, nextMessages: input.rawMessages };
  }

  const recent = input.rawMessages.slice(-keepRecentMessages);
  const older = input.rawMessages.slice(0, -keepRecentMessages);
  const olderTokens = older.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  const recentTokens = recent.reduce((sum, message) => sum + estimateMessageTokens(message), 0);

  if (olderTokens < minimumPruneTokens && recentTokens < protectTokens) {
    return { pruned: false, removedCount: 0, nextMessages: input.rawMessages };
  }

  let nextMessages = recent;
  if (input.artifact && !hasArtifactSystemMessage(nextMessages[0])) {
    nextMessages = [toArtifactSystemMessage(input.artifact), ...nextMessages];
  }

  return { pruned: true, removedCount: older.length, nextMessages };
}
