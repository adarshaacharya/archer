import type { SessionState } from "./session-state.js";
import type { Tui } from "@xeq/tui";
import { resetSessionById } from "@xeq/agent-core";
import { appendTurnResult, getTurnResults } from "@xeq/storage";
import { routeInput, type InputIntent, type RoutedInput } from "./intent-router.js";
import { runResearchTask } from "./research-runner.js";
import { runTask } from "./task-runner.js";
import { maybePruneSessionBeforeTurn } from "./recovery/prune.js";
import type { TurnResult } from "./turn-types.js";

export async function runTurn(
  input: string,
  tui: Tui,
  state: SessionState,
  abortController?: AbortController,
): Promise<TurnResult> {
  const recentTurns = await getTurnResults(state.sessionId, 5);
  const compactionPolicy = deriveCompactionPolicy(recentTurns);
  const preturnPrune = await maybePruneSessionBeforeTurn(state.sessionId, {
    provider: state.provider,
    modelId: state.modelId,
    protectTokens: compactionPolicy.protectTokens,
    prunableTokens: compactionPolicy.prunableTokens,
  });
  if (
    preturnPrune.prunedCount > 0 ||
    preturnPrune.modelMessagesPruned > 0 ||
    preturnPrune.artifactCreated
  ) {
    resetSessionById(state.sessionId);
  }
  if (preturnPrune.prunedCount > 0 || preturnPrune.modelMessagesPruned > 0) {
    tui.renderApprovalPrompt({
      message:
        `Compacted session context before running the turn (` +
        `${preturnPrune.prunedCount} transcript${preturnPrune.prunedCount === 1 ? "" : "s"} pruned, ` +
        `${preturnPrune.modelMessagesPruned} model message${preturnPrune.modelMessagesPruned === 1 ? "" : "s"} trimmed` +
        `${preturnPrune.artifactCreated ? ", continuation brief saved" : ""}).`,
    });
  }

  const routed = routeInputWithHistory(input, recentTurns);
  if (routed.intent === "ambiguous") {
    const message = `Please ask a concrete question, a research request, or a code change task. ${routed.reason}`;
    tui.renderAssistantMessage(message);
    const result: TurnResult = {
      status: "clarify",
      intent: routed.intent,
      task: input.trim(),
      message,
    };
    await persistTurnResult(state.sessionId, result);
    return result;
  }

  const result =
    routed.intent === "change"
      ? await runTask(routed.task, tui, state, abortController)
      : await runResearchTask(routed.task, routed.intent, tui, state, abortController);

  await persistTurnResult(state.sessionId, result);
  return result;
}

async function persistTurnResult(sessionId: string, result: TurnResult): Promise<void> {
  await appendTurnResult({
    id: `${sessionId}_turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    intent: result.intent,
    status: result.status,
    task: result.task,
    summary: result.summary,
    message: result.message,
  });
}

export function routeInputWithHistory(
  input: string,
  recentTurns: Array<{ intent: string; status: string; task: string }>,
): RoutedInput {
  const routed = routeInput(input);
  if (routed.intent !== "ambiguous") {
    return routed;
  }

  const normalized = input.trim().toLowerCase();
  const continuationCue = /^(also|and|then|now|next|continue|continue with|do that|fix that|same|again)\b/.test(
    normalized,
  );
  if (!continuationCue) {
    return routed;
  }

  const lastMeaningfulTurn = [...recentTurns]
    .reverse()
    .find((turn) => turn.status !== "clarify" && isIntent(turn.intent));
  if (!lastMeaningfulTurn) {
    return routed;
  }

  return {
    intent: lastMeaningfulTurn.intent,
    task: input.trim(),
  };
}

export function deriveCompactionPolicy(
  recentTurns: Array<{ status: string; summary?: unknown }>,
): { protectTokens: number; prunableTokens: number } {
  const base = { protectTokens: 12_500, prunableTokens: 6_250 };
  const recentFailures = recentTurns.filter(
    (turn) => turn.status === "failed" || turn.status === "cancelled",
  ).length;
  const highStepTurns = recentTurns.filter((turn) => {
    const summary = turn.summary as { steps?: unknown } | null | undefined;
    return typeof summary?.steps === "number" && summary.steps >= 40;
  }).length;

  if (recentFailures >= 2 || highStepTurns >= 2) {
    return {
      protectTokens: 10_000,
      prunableTokens: 5_000,
    };
  }

  return base;
}

function isIntent(value: string): value is Exclude<InputIntent, "ambiguous"> {
  return value === "change" || value === "question" || value === "research";
}
