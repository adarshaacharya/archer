import type { SessionState } from "./session-state.js";
import type { Tui } from "@xeq/tui";
import { deriveCompactionPolicy, resetSessionById } from "@xeq/agent-core";
import { appendTurnResult, getTurnResults } from "@xeq/storage";
import { routeInput, type InputIntent, type RoutedInput } from "./intent-router.js";
import { runTask } from "./task-runner.js";
import { maybePruneSessionBeforeTurn } from "./recovery/prune.js";
import type { TurnResult } from "./turn-types.js";

type RunTurnDeps = {
  getTurnResults: typeof getTurnResults;
  maybePruneSessionBeforeTurn: typeof maybePruneSessionBeforeTurn;
  resetSessionById: typeof resetSessionById;
  runTask: typeof runTask;
  appendTurnResult: typeof appendTurnResult;
};

export async function runTurn(
  input: string,
  tui: Tui,
  state: SessionState,
  abortController?: AbortController,
): Promise<TurnResult> {
  return runTurnWithDeps(
    {
      getTurnResults,
      maybePruneSessionBeforeTurn,
      resetSessionById,
      runTask,
      appendTurnResult,
    },
    input,
    tui,
    state,
    abortController,
  );
}

export async function runTurnWithDeps(
  deps: RunTurnDeps,
  input: string,
  tui: Tui,
  state: SessionState,
  abortController?: AbortController,
): Promise<TurnResult> {
  const recentTurns = await deps.getTurnResults(state.sessionId, 5);
  const compactionPolicy = deriveCompactionPolicy(recentTurns);
  const preturnPrune = await deps.maybePruneSessionBeforeTurn(state.sessionId, {
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
    deps.resetSessionById(state.sessionId);
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
    await persistTurnResult(deps.appendTurnResult, state.sessionId, result);
    return result;
  }

  const result = await deps.runTask(routed.task, tui, state, abortController, routed.intent);

  await persistTurnResult(deps.appendTurnResult, state.sessionId, result);
  return result;
}

async function persistTurnResult(
  append: typeof appendTurnResult,
  sessionId: string,
  result: TurnResult,
): Promise<void> {
  await append({
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

  const intent = lastMeaningfulTurn.intent as Exclude<InputIntent, "ambiguous">;
  return {
    intent,
    task: input.trim(),
  };
}

function isIntent(value: string): value is Exclude<InputIntent, "ambiguous"> {
  return value === "change" || value === "question" || value === "research";
}
