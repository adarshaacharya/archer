import type { TurnResult, TurnSummary } from "../../features/runtime/turn-types.js";
import type { HarnessRuntimeConfig } from "@archer/shared/runtime";
import { runHarnessPath } from "../task/harness-answer-path.js";

export function shouldUseHarnessPath(input: {
  declaredIntent: TurnResult["intent"];
  workflowKind?: "default" | "commit" | "compact";
}): boolean {
  return (
    process.env.ARCHER_USE_HARNESS_PATH === "1" &&
    input.workflowKind !== "commit" &&
    input.workflowKind !== "compact"
  );
}

export async function executeHarnessRoute(input: {
  mode: "answer" | "change";
  task: string;
  repoRoot: string;
  modelId: string;
  sessionId: string;
  maxSteps: number;
  maxDurationMs: number;
  env: unknown;
  harnessConfig: HarnessRuntimeConfig;
  requestApprovalForTool: (approvalRequest: {
    toolName: string;
    permission: "read" | "edit" | "bash" | "web" | "unknown";
    reason: string;
  }) => Promise<boolean>;
  elapsedMs: () => number;
  buildSummary: (
    fields: Omit<TurnSummary, "compaction" | "evalMetrics"> &
      Partial<Pick<TurnSummary, "evalMetrics">>,
  ) => TurnSummary;
  buildTurnResult: (
    status: TurnResult["status"],
    summary?: TurnSummary,
    message?: string,
  ) => TurnResult;
  onCompleted: (message: string) => void;
  onFailed: () => void;
}): Promise<TurnResult> {
  const harnessResult = await runHarnessPath({
    mode: input.mode,
    task: input.task,
    cwd: input.repoRoot,
    modelId: input.modelId,
    sessionId: input.sessionId,
    turnId: `${input.sessionId}_${Date.now().toString(36)}`,
    maxSteps: Math.min(24, input.maxSteps),
    timeoutMs: input.maxDurationMs,
    providers: input.env as never,
    runtimeConfig: input.harnessConfig,
    requestApproval: input.requestApprovalForTool,
  });

  if (harnessResult.status === "completed") {
    const message = harnessResult.outputText.trim() || "Task complete";
    input.onCompleted(message);
    return input.buildTurnResult(
      "completed",
      input.buildSummary({
        success: true,
        steps: harnessResult.steps,
        durationMs: input.elapsedMs(),
        promptTokens: 0,
        completionTokens: 0,
        estimatedCostUsd: 0,
      }),
    );
  }

  input.onFailed();
  return input.buildTurnResult(
    harnessResult.status === "cancelled" ? "cancelled" : "failed",
    input.buildSummary({
      success: false,
      steps: harnessResult.steps,
      durationMs: input.elapsedMs(),
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
    }),
    harnessResult.error ?? "Harness answer path failed",
  );
}
