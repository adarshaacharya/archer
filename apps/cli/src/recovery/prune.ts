import {
  generateCompactContinuationArtifact,
  estimateModelMessageTokens as estimateProviderMessageTokens,
  estimateTextTokens as estimateProviderTextTokens,
  type SupportedProvider,
} from "@xeq/model-providers";
import {
  buildCompactContinuationArtifact,
  estimateSessionTranscriptPressure,
  loadLatestCompactContinuationArtifact,
  pruneModelMessagesWithArtifact,
  pruneSessionTranscripts,
  saveCompactContinuationArtifact,
} from "@xeq/storage";

const PRETURN_PROTECT_TOKENS = 12_500;
const PRETURN_PRUNABLE_TOKENS = 6_250;

export async function pruneSessionAfterTurn(sessionId: string): Promise<number> {
  return pruneSessionTranscripts({
    sessionId,
    protectTokens: 10_000,
    minimumTokens: 5_000,
    keepRecentAssistantMessages: 2,
  });
}

function tokenEstimators(provider?: SupportedProvider | null, modelId?: string) {
  return {
    estimateText: (text: string) =>
      estimateProviderTextTokens({
        text,
        provider,
        modelId,
      }),
    estimateMessage: (message: import("ai").ModelMessage) =>
      estimateProviderMessageTokens({
        message,
        provider,
        modelId,
      }),
  };
}

export async function maybePruneSessionBeforeTurn(
  sessionId: string,
  opts?: {
    provider?: SupportedProvider | null;
    modelId?: string;
    protectTokens?: number;
    prunableTokens?: number;
  },
): Promise<{
  shouldPrune: boolean;
  prunedCount: number;
  modelMessagesPruned: number;
  retainedTokens: number;
  prunableTokens: number;
  artifactCreated: boolean;
}> {
  const estimators = tokenEstimators(opts?.provider, opts?.modelId);
  const pressure = await estimateSessionTranscriptPressure({
    sessionId,
    keepRecentAssistantMessages: 2,
    estimateTokens: estimators.estimateText,
  });

  const protectTokens = opts?.protectTokens ?? PRETURN_PROTECT_TOKENS;
  const prunableTokens = opts?.prunableTokens ?? PRETURN_PRUNABLE_TOKENS;

  const shouldPrune =
    pressure.retainedTokens >= protectTokens && pressure.prunableTokens >= prunableTokens;

  if (!shouldPrune) {
    return {
      shouldPrune: false,
      prunedCount: 0,
      modelMessagesPruned: 0,
      retainedTokens: pressure.retainedTokens,
      prunableTokens: pressure.prunableTokens,
      artifactCreated: false,
    };
  }

  let artifactCreated = false;
  const latestArtifact = await loadLatestCompactContinuationArtifact(sessionId);
  const artifact = await buildCompactContinuationArtifact({
    sessionId,
    keepRecentAssistantMessages: 2,
    builder: async (content) =>
      generateCompactContinuationArtifact({
        content,
        provider: opts?.provider,
        modelId: opts?.modelId,
      }),
  });
  if (
    artifact &&
    (!latestArtifact ||
      latestArtifact.summary !== artifact.summary ||
      latestArtifact.criticalFiles.join("\n") !== artifact.criticalFiles.join("\n"))
  ) {
    await saveCompactContinuationArtifact({
      sessionId,
      artifact,
    });
    artifactCreated = true;
  }

  const prunedCount = await pruneSessionTranscripts({
    sessionId,
    protectTokens: 10_000,
    minimumTokens: 5_000,
    keepRecentAssistantMessages: 2,
    estimateTokens: estimators.estimateText,
  });
  const modelPrune = await pruneModelMessagesWithArtifact({
    sessionId,
    protectTokens: 12_500,
    minimumPruneTokens: 5_000,
    keepRecentMessages: 12,
    estimateModelMessageTokens: estimators.estimateMessage,
  });

  return {
    shouldPrune: prunedCount > 0,
    prunedCount,
    modelMessagesPruned: modelPrune.removedCount,
    retainedTokens: pressure.retainedTokens,
    prunableTokens: pressure.prunableTokens,
    artifactCreated,
  };
}
