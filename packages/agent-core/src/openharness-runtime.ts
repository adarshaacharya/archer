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
  const runId = newRunId();
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sessionKey = deps.sessionId ? sanitizeId(deps.sessionId) : runId;
  const runtime = getOrCreateSession(options.cwd, deps.modelId, deps.instructions, sessionKey);
  let stepCounter = 0;
  let finalText = "";

  deps.onStep?.({
    step: 1,
    action: "model.generate",
    thought: "thinking",
    observation: "starting (openharness)",
  });

  const run = async () => {
    for await (const event of runtime.session.send(prompt)) {
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
    return {
      status: "failed",
      steps: Math.max(1, stepCounter),
      outputText: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
