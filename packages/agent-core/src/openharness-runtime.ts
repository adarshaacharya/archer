import { DEFAULT_MAX_STEPS, DEFAULT_TIMEOUT_MS, type RunOptions, type RunResult } from "./types.js";
import { mapEvent } from "./runtime/events.js";
import { newRunId, sanitizeId } from "./runtime/ids.js";
import type { OpenHarnessRuntimeDeps } from "./runtime/openharness-types.js";
import { getOrCreateSession } from "./runtime/session.js";
import { withTimeout } from "./runtime/timeout.js";


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
  const runtime = getOrCreateSession({ cwd: options.cwd, providers: deps.providers, modelId: deps.modelId, instructions: deps.instructions, sessionId: sessionKey });
  let stepCounter = 0;
  let finalText = "";

  deps.onStep?.({
    step: 1,
    action: "model.generate",
    thought: "thinking",
    observation: "starting (openharness)",
  });

  const run = async () => {
    const stream = runtime.session.send(prompt);
    for await (const event of stream) {
        if (isAborted()) {
          if (typeof stream.return === "function") {
          await stream.return(undefined);
          }
          throw new Error("__XEQ_CANCELLED__");
        }
      mapEvent(event, deps.onStep, ++stepCounter, (text) => {
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
    if (message === "__XEQ_CANCELLED__" || isAborted()) {
      return {
        status: "cancelled",
        steps: Math.max(1, stepCounter),
        outputText: "",
        error: "Run cancelled",
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
