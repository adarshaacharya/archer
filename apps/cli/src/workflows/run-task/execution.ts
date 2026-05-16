import {
  buildDirectAnswerPrompt,
  buildDirectAnswerSystemPrompt,
  buildWebAnswerPrompt,
  buildWebAnswerSystemPrompt,
} from "@archer/agent-core";
import type { UiEvent } from "@archer/tui";
import type { TurnResult } from "../../features/runtime/turn-types.js";
import type { TaskExecutionRoute } from "./route.js";

type PhaseUsage = {
  promptTokens?: number;
  completionTokens?: number;
};

type PhaseResult = {
  status: string;
  steps: number;
  outputText: string;
  usage?: PhaseUsage;
  estimatedCostUsd?: number;
};

type RunPhase = (
  prompt: string,
  isAnswerTurn: boolean,
  maxSteps: number,
  opts?: {
    allowTools?: boolean;
    allowedToolNames?: string[];
    instructions?: string;
  },
) => Promise<PhaseResult>;

type TurnResultLike = {
  status: TurnResult["status"];
  summary?: any;
  message?: string;
};

type ExecuteEarlyRouteParams = {
  route: TaskExecutionRoute;
  task: string;
  allowedToolNames: string[];
  runPhase: RunPhase;
  emitUiEvent: (event: UiEvent) => void;
  elapsedMs: () => number;
  buildSummary: (input: {
    success: boolean;
    steps: number;
    durationMs: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
  }) => any;
  pruneAfterTurn: () => void;
  buildTurnResult: (
    status: TurnResult["status"],
    summary?: any,
    message?: string,
  ) => TurnResultLike;
  onCompleted: () => void;
  onCancelled: () => void;
  onFailed: () => void;
};

export async function executeEarlyRoute(
  params: ExecuteEarlyRouteParams,
): Promise<TurnResultLike | null> {
  const {
    route,
    task,
    allowedToolNames,
    runPhase,
    emitUiEvent,
    elapsedMs,
    buildSummary,
    pruneAfterTurn,
    buildTurnResult,
    onCompleted,
    onCancelled,
    onFailed,
  } = params;

  if (route !== "direct-answer" && route !== "web-context") {
    return null;
  }

  if (route === "direct-answer") {
    emitUiEvent({ type: "approval-prompt", prompt: { message: "Answering directly..." } });
  } else {
    emitUiEvent({ type: "approval-prompt", prompt: { message: "Inspecting web content..." } });
  }

  const phaseResult = await runPhase(
    route === "direct-answer" ? buildDirectAnswerPrompt(task) : buildWebAnswerPrompt(task),
    true,
    8,
    route === "direct-answer"
      ? {
          allowTools: false,
          allowedToolNames,
          instructions: buildDirectAnswerSystemPrompt(),
        }
      : {
          allowedToolNames,
          instructions: buildWebAnswerSystemPrompt(),
        },
  );

  if (phaseResult.status === "completed") {
    onCompleted();
    const summary = buildSummary({
      success: true,
      steps: phaseResult.steps,
      durationMs: elapsedMs(),
      promptTokens: phaseResult.usage?.promptTokens ?? 0,
      completionTokens: phaseResult.usage?.completionTokens ?? 0,
      estimatedCostUsd: phaseResult.estimatedCostUsd ?? 0,
    });
    emitUiEvent({ type: "summary", summary });
    pruneAfterTurn();
    return buildTurnResult("completed", summary, phaseResult.outputText);
  }

  if (phaseResult.status === "cancelled") {
    onCancelled();
    return buildTurnResult("cancelled", undefined, phaseResult.outputText);
  }

  onFailed();
  return buildTurnResult("failed", undefined, phaseResult.outputText);
}
