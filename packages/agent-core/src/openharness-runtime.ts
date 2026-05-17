import { estimateUsageCost } from "@archer/model-providers";
import type { SessionEvent } from "@openharness/core";
import { mapEvent } from "./runtime/events.js";
import { newRunId, sanitizeId } from "./runtime/ids.js";
import type { HarnessRuntimeDeps } from "./runtime/harness-types.js";
import { getOrCreateSession } from "./runtime/session.js";
import { withTimeout } from "./runtime/timeout.js";
import { DEFAULT_MAX_STEPS, DEFAULT_TIMEOUT_MS, type RunOptions, type RunResult } from "./types.js";

const CANCELLED_ERROR = "__ARCHER_CANCELLED__";
const MAX_STEPS_ERROR = "__ARCHER_MAX_STEPS__";

function addUsage(
  current:
    | {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      }
    | undefined,
  next: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  },
): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  if (!current) {
    return { ...next };
  }

  return {
    promptTokens: current.promptTokens + next.promptTokens,
    completionTokens: current.completionTokens + next.completionTokens,
    totalTokens: current.totalTokens + next.totalTokens,
  };
}

function isBudgetedStep(event: SessionEvent): boolean {
  return event.type === "tool.start";
}

export async function runOpenHarnessRuntime(
  deps: HarnessRuntimeDeps,
  prompt: string,
  options: RunOptions,
): Promise<RunResult> {
  const isAborted = (): boolean => !!options.abortSignal?.aborted;
  if (isAborted()) {
    return {
      status: "cancelled",
      steps: 0,
      outputText: "",
      error: "Run cancelled",
    };
  }

  const runId = newRunId();
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sessionKey = deps.sessionId ? sanitizeId(deps.sessionId) : runId;
  const runtime = getOrCreateSession({
    cwd: options.cwd,
    providers: deps.providers,
    modelId: deps.modelId,
    instructions: deps.instructions,
    approveToolCall: deps.approveToolCall,
    approvePatchApply: deps.approvePatchApply,
    sessionId: sessionKey,
  });
  let stepCounter = 0;
  let streamEventCounter = 0;
  let finalText = "";
  let usage:
    | {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      }
    | undefined;
  const handleUsage = deps.onUsage
    ? (
        next: { promptTokens: number; completionTokens: number; totalTokens: number },
        replace?: boolean,
      ) => {
        usage = replace ? { ...next } : addUsage(usage, next);
        const resolvedUsage = usage ?? next;
        deps.onUsage?.(resolvedUsage, replace);
      }
    : undefined;

  const run = async () => {
    if (!runtime.loaded) {
      await runtime.session.load();
      runtime.loaded = true;
    }

    const stream = runtime.session.send(prompt);
    for await (const event of stream) {
      if (isAborted()) {
        if (typeof stream.return === "function") {
          await stream.return(undefined);
        }
        throw new Error(CANCELLED_ERROR);
      }

      const isStep = isBudgetedStep(event);
      if (isStep && stepCounter >= maxSteps) {
        if (typeof stream.return === "function") {
          await stream.return(undefined);
        }
        throw new Error(MAX_STEPS_ERROR);
      }
      if (isStep) {
        stepCounter += 1;
      }
      streamEventCounter += 1;

      mapEvent(
        event,
        deps.onStep,
        deps.onToolEvent,
        deps.onTextDelta,
        handleUsage,
        Math.max(1, stepCounter),
        (text) => {
          finalText += text;
        },
      );
    }
  };

  try {
    await withTimeout(run(), timeoutMs);
    const text = finalText.trim() || "Task complete";
    const resolvedUsage = usage ?? {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    deps.onStep?.({
      step: Math.max(1, stepCounter + 1),
      action: "model.final",
      thought: "completed",
      observation: text,
    });

    return {
      status: "completed",
      steps: Math.max(1, stepCounter),
      outputText: text,
      usage: resolvedUsage,
      estimatedCostUsd: estimateUsageCost({ pricing: runtime.pricing, usage: resolvedUsage }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === CANCELLED_ERROR || isAborted()) {
      const resolvedUsage = usage ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
      return {
        status: "cancelled",
        steps: Math.max(1, stepCounter || streamEventCounter),
        outputText: "",
        error: "Run cancelled",
        usage: resolvedUsage,
        estimatedCostUsd: estimateUsageCost({ pricing: runtime.pricing, usage: resolvedUsage }),
      };
    }

    if (message === MAX_STEPS_ERROR) {
      const resolvedUsage = usage ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
      return {
        status: "failed",
        steps: Math.max(1, stepCounter),
        outputText: finalText.trim(),
        error: `Run exceeded maxSteps=${maxSteps}`,
        usage: resolvedUsage,
        estimatedCostUsd: estimateUsageCost({ pricing: runtime.pricing, usage: resolvedUsage }),
      };
    }

    const resolvedUsage = usage ?? {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    return {
      status: "failed",
      steps: Math.max(1, stepCounter || streamEventCounter),
      outputText: "",
      error: message,
      usage: resolvedUsage,
      estimatedCostUsd: estimateUsageCost({ pricing: runtime.pricing, usage: resolvedUsage }),
    };
  }
}
