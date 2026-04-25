import { mapEvent } from "./runtime/events.js";
import { newRunId, sanitizeId } from "./runtime/ids.js";
import type { OpenHarnessRuntimeDeps } from "./runtime/openharness-types.js";
import { getOrCreateSession } from "./runtime/session.js";
import { withTimeout } from "./runtime/timeout.js";
import { DEFAULT_MAX_STEPS, DEFAULT_TIMEOUT_MS, type RunOptions, type RunResult } from "./types.js";

const CANCELLED_ERROR = "__XEQ_CANCELLED__";
const MAX_STEPS_ERROR = "__XEQ_MAX_STEPS__";

export async function runOpenHarnessRuntime(
  deps: OpenHarnessRuntimeDeps,
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
    sessionId: sessionKey,
  });
  let stepCounter = 0;
  let finalText = "";

  const run = async () => {
    const stream = runtime.session.send(prompt);
    for await (const event of stream) {
      if (isAborted()) {
        if (typeof stream.return === "function") {
          await stream.return(undefined);
        }
        throw new Error(CANCELLED_ERROR);
      }

      if (stepCounter >= maxSteps) {
        if (typeof stream.return === "function") {
          await stream.return(undefined);
        }
        throw new Error(MAX_STEPS_ERROR);
      }

      mapEvent(event, deps.onStep, deps.onTextDelta, ++stepCounter, (text) => {
        finalText += text;
      });
    }
  };

  try {
    await withTimeout(run(), timeoutMs);
    const text = finalText.trim() || "Task complete";
    deps.onStep?.({
      step: Math.max(1, stepCounter + 1),
      action: "model.final",
      thought: "completed",
      observation: text,
    });

    return {
      status: "completed",
      steps: Math.max(1, Math.min(stepCounter + 1, maxSteps + 2)),
      outputText: text,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === CANCELLED_ERROR || isAborted()) {
      return {
        status: "cancelled",
        steps: Math.max(1, stepCounter),
        outputText: "",
        error: "Run cancelled",
      };
    }

    if (message === MAX_STEPS_ERROR) {
      return {
        status: "failed",
        steps: Math.max(1, stepCounter),
        outputText: finalText.trim(),
        error: `Run exceeded maxSteps=${maxSteps}`,
      };
    }

    return {
      status: "failed",
      steps: Math.max(1, stepCounter),
      outputText: "",
      error: message,
    };
  }
}
