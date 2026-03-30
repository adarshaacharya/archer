import { performance } from "node:perf_hooks";
import type { ModelProvider } from "@xeq/model-providers";
import type { AgentRequest, AgentStep, RunSummary } from "@xeq/shared";

export interface RunHooks {
  onStep?: (step: AgentStep) => void;
  onSummary?: (summary: RunSummary) => void;
}

export async function runAgent(
  request: AgentRequest,
  provider: ModelProvider,
  hooks: RunHooks = {},
): Promise<RunSummary> {
  const startedAt = performance.now();

  let step = 0;
  while (step < request.maxSteps) {
    step += 1;
    const reply = await provider.complete([
      {
        role: "user",
        content: `Task: ${request.task}. Step ${step}/${request.maxSteps}`,
      },
    ]);

    hooks.onStep?.({
      step,
      action: "model.complete",
      thought: "Requesting next model action",
      observation: reply.content,
    });

    if (reply.content.includes("DONE")) break;
  }

  const summary: RunSummary = {
    success: true,
    steps: step,
    durationMs: Math.round(performance.now() - startedAt),
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
  };

  hooks.onSummary?.(summary);
  return summary;
}
