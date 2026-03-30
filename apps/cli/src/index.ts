import { type RunHooks, runAgent } from "@xeq/agent-core";
import {
  type ModelMessage,
  type ModelProvider,
  type ModelResponse,
  OpenRouterProvider,
} from "@xeq/model-providers";
import { type AgentRequest, AgentRequestSchema } from "@xeq/shared";
import { OpenTui } from "@xeq/tui";

class StubProvider implements ModelProvider {
  private calls = 0;

  async complete(_messages: ModelMessage[]): Promise<ModelResponse> {
    this.calls += 1;
    if (this.calls >= 3) {
      return { content: "DONE: stub run complete" };
    }
    return { content: `Stub response step ${this.calls}` };
  }
}

function getTaskFromArgv(): string {
  const raw = process.argv.slice(2).join(" ").trim();
  return raw.length > 0 ? raw : "Scaffold authentication module and tests";
}

function buildRequest(task: string): AgentRequest {
  return AgentRequestSchema.parse({
    task,
    repoRoot: process.cwd(),
    approvalMode: "suggest",
    maxSteps: 6,
    maxDurationMs: 120000,
  });
}

async function main(): Promise<void> {
  const task = getTaskFromArgv();
  const request = buildRequest(task);
  const model = process.env.AGENT_MODEL ?? "openai/gpt-4o-mini";
  const apiKey = process.env.OPENROUTER_API_KEY;

  const provider: ModelProvider = apiKey
    ? new OpenRouterProvider(model, apiKey)
    : new StubProvider();

  const tui = new OpenTui();
  await tui.start();
  tui.renderApprovalPrompt({
    message: `Mode=${request.approvalMode} | Task=${request.task}`,
    options: ["approve", "deny"],
  });

  const hooks: RunHooks = {
    onStep(step) {
      tui.renderStep(step);
    },
    onSummary(summary) {
      tui.renderSummary(summary);
    },
  };

  try {
    await runAgent(request, provider, hooks);
  } catch (error) {
    tui.renderApprovalPrompt({
      message: `Run failed: ${error instanceof Error ? error.message : String(error)}`,
      options: ["exit"],
    });
  } finally {
    setTimeout(() => {
      tui.stop();
      process.exit(0);
    }, 1200);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
