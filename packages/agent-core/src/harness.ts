import { type AgentMiddleware, composeMiddleware } from "./middleware.js";
import {
  type AgentState,
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MS,
  type ModelDecision,
  type RunContext,
  type RunOptions,
  type RunResult,
  type ToolCall,
  type ToolResult,
} from "./types.js";

export interface ModelAdapter {
  decide(input: {
    state: AgentState;
    run: RunContext;
    signal: AbortSignal;
  }): Promise<ModelDecision>;
}

export interface ToolAdapter {
  execute(
    call: ToolCall,
    input: { state: AgentState; run: RunContext; signal: AbortSignal },
  ): Promise<ToolResult>;
}

export interface HarnessDeps {
  model: ModelAdapter;
  tools: ToolAdapter;
  middlewares?: AgentMiddleware[];
}

function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function runHarness(
  deps: HarnessDeps,
  prompt: string,
  options: RunOptions,
): Promise<RunResult> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const run: RunContext = {
    runId: newRunId(),
    startedAt: Date.now(),
    cwd: options.cwd,
    maxSteps,
    step: 0,
  };

  const state: AgentState = {
    messages: [{ role: "user", content: prompt }],
  };

  const middleware = composeMiddleware(deps.middlewares ?? []);
  const controller = new AbortController();
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    while (run.step < maxSteps) {
      await middleware.runPreModel({ run, state });

      const decision = await deps.model.decide({
        run,
        state,
        signal: controller.signal,
      });

      await middleware.runPostModel({ run, state, decision });

      if (decision.type === "final") {
        state.messages.push({ role: "assistant", content: decision.text });

        return {
          status: "completed",
          steps: run.step + 1,
          outputText: decision.text,
        };
      }

      const call = decision.call;
      await middleware.runPreTool({ run, state, call });

      const result = await deps.tools.execute(call, {
        run,
        state,
        signal: controller.signal,
      });

      await middleware.runPostTool({ run, state, call, result });

      state.lastToolResult = result;
      state.messages.push({
        role: "tool",
        content: JSON.stringify({ call, result }),
      });

      run.step += 1;
    }

    return {
      status: "failed",
      steps: run.step,
      outputText: "",
      error: `max steps reached (${maxSteps})`,
    };
  } catch (error) {
    await middleware.runOnError({ run, state, error });

    if (timedOut) {
      return { status: "timed_out", steps: run.step, outputText: "", error: "run timed out" };
    }

    if (controller.signal.aborted) {
      return { status: "cancelled", steps: run.step, outputText: "", error: "run cancelled" };
    }

    return {
      status: "failed",
      steps: run.step,
      outputText: "",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
    await middleware.runOnFinish({ run, state });
  }
}
