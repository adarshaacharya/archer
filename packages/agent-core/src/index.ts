import { performance } from "node:perf_hooks";
import type { ModelProvider } from "@xeq/model-providers";
import type { AgentRequest, RunSummary } from "@xeq/shared";

export async function runAgent(
  request: AgentRequest,
  provider: ModelProvider,
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

    if (reply.content.includes("DONE")) break;
  }

  return {
    success: true,
    steps: step,
    durationMs: Math.round(performance.now() - startedAt),
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
  };
}
