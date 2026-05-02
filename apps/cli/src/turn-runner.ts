import type { SessionState } from "./session-state.js";
import type { Tui } from "@xeq/tui";
import { resetSessionById } from "@xeq/agent-core";
import { appendTurnResult } from "@xeq/storage";
import { routeInput } from "./intent-router.js";
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
  const preturnPrune = await maybePruneSessionBeforeTurn(state.sessionId, {
    provider: state.provider,
    modelId: state.modelId,
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

  const routed = routeInput(input);
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
