import { deriveCompactionPolicy, resetSessionById } from "@archer/agent-core";
import { type ComposerSubmission, createPlainComposerSubmission } from "@archer/shared/composer";
import { appendTurnResult, getTurnResults } from "@archer/storage";
import type { Tui } from "@archer/tui";
import { maybePruneSessionBeforeTurn } from "../../features/runtime/session-pruning.js";
import type { TurnResult } from "../../features/runtime/turn-types.js";
import type { SessionState } from "../../features/sessions/session-state.js";
import { runTask } from "../task/run-task.js";

type RunTurnDeps = {
  getTurnResults: typeof getTurnResults;
  maybePruneSessionBeforeTurn: typeof maybePruneSessionBeforeTurn;
  resetSessionById: typeof resetSessionById;
  runTask: typeof runTask;
  appendTurnResult: typeof appendTurnResult;
};

export async function runTurn(
  input: ComposerSubmission,
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
  input: string | ComposerSubmission,
  tui: Tui,
  state: SessionState,
  abortController?: AbortController,
): Promise<TurnResult> {
  const submission = typeof input === "string" ? createPlainComposerSubmission(input) : input;
  const trimmedInput = submission.text.trim();
  if (!trimmedInput) {
    const message = "Please enter a task or question.";
    tui.renderAssistantMessage(message);
    const result: TurnResult = {
      status: "clarify",
      intent: "question",
      task: trimmedInput,
      message,
    };
    await persistTurnResult(deps.appendTurnResult, state.sessionId, result);
    return result;
  }

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
      message: `Compacted session context before running the turn (${preturnPrune.prunedCount} transcript${preturnPrune.prunedCount === 1 ? "" : "s"} pruned, ${preturnPrune.modelMessagesPruned} model message${preturnPrune.modelMessagesPruned === 1 ? "" : "s"} trimmed${preturnPrune.artifactCreated ? ", continuation brief saved" : ""}).`,
    });
  }

  const result = await deps.runTask(
    { ...submission, text: trimmedInput },
    tui,
    state,
    abortController,
  );

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
