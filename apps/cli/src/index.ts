import { performance } from "node:perf_hooks";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import {
  type AgentMiddleware,
  type ModelAdapter,
  type ToolAdapter,
  runHarness,
} from "@xeq/agent-core";
import { type ModelProvider, type ModelResponse, OpenRouterProvider } from "@xeq/model-providers";
import { AgentRequestSchema } from "@xeq/shared";
import { ConsoleTui, OpenTui, type Tui } from "@xeq/tui";
import type { ModelMessage } from "ai";

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

type CliMode = "interactive" | "run";

interface CliArgs {
  mode: CliMode;
  task?: string;
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.length === 0) {
    return { mode: "interactive" };
  }

  if (argv[0] === "run") {
    const task = argv.slice(1).join(" ").trim();
    return {
      mode: "run",
      task: task.length > 0 ? task : "Scaffold authentication module and tests",
    };
  }

  return { mode: "interactive" };
}

function createModelAdapter(provider: ModelProvider): ModelAdapter {
  return {
    async decide({ state, signal }) {
      const response = await provider.complete(state.messages as ModelMessage[]);
      if (signal.aborted) {
        throw new Error("run aborted");
      }

      const text = response.content.trim();
      if (text.startsWith("DONE:")) {
        return {
          type: "final",
          text: text.replace(/^DONE:\s*/, ""),
        };
      }

      return { type: "final", text };
    },
  };
}

function createToolAdapter(): ToolAdapter {
  return {
    async execute(call) {
      return {
        ok: false,
        error: {
          code: "TOOL_NOT_IMPLEMENTED",
          message: `Tool ${call.name} not implemented yet`,
        },
      };
    },
  };
}

async function runTask(
  task: string,
  tui: Tui,
  modelAdapter: ModelAdapter,
  toolAdapter: ToolAdapter,
): Promise<void> {
  const request = AgentRequestSchema.parse({
    task,
    repoRoot: process.cwd(),
    approvalMode: "suggest",
    maxSteps: 6,
    maxDurationMs: 120000,
  });

  tui.renderApprovalPrompt({
    message: `Mode=${request.approvalMode} | Task=${request.task}`,
    options: ["approve", "deny"],
  });

  const middlewares: AgentMiddleware[] = [
    {
      postModel({ run, decision }) {
        tui.renderStep({
          step: run.step + 1,
          action: "model.decide",
          thought: decision.type,
          observation: decision.type === "final" ? decision.text : decision.call.name,
        });
      },
      postTool({ run, call, result }) {
        tui.renderStep({
          step: run.step + 1,
          action: `tool.${call.name}`,
          observation: result.ok ? "ok" : (result.error?.message ?? "failed"),
        });
      },
    },
  ];

  const started = performance.now();
  const result = await runHarness(
    {
      model: modelAdapter,
      tools: toolAdapter,
      middlewares,
    },
    request.task,
    {
      cwd: request.repoRoot,
      maxSteps: request.maxSteps,
      timeoutMs: request.maxDurationMs,
    },
  );

  tui.renderSummary({
    success: result.status === "completed",
    steps: result.steps,
    durationMs: Math.round(performance.now() - started),
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
  });
}

async function runInteractive(
  tui: Tui,
  modelAdapter: ModelAdapter,
  toolAdapter: ToolAdapter,
): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  const question = (prompt: string) =>
    new Promise<string>((resolve) => {
      rl.question(prompt, resolve);
    });
  try {
    while (true) {
      const line = (await question("xeq> ")).trim();
      if (line.length === 0) continue;
      if (line === "exit" || line === "quit") break;

      try {
        await runTask(line, tui, modelAdapter, toolAdapter);
      } catch (error) {
        tui.renderApprovalPrompt({
          message: `Run failed: ${error instanceof Error ? error.message : String(error)}`,
          options: ["continue", "exit"],
        });
      }
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const { mode, task } = parseArgs(process.argv.slice(2));
  const model = process.env.AGENT_MODEL ?? "openai/gpt-4o-mini";
  const apiKey = process.env.OPENROUTER_API_KEY;

  const provider: ModelProvider = apiKey
    ? new OpenRouterProvider(model, apiKey)
    : new StubProvider();
  const modelAdapter = createModelAdapter(provider);
  const toolAdapter = createToolAdapter();

  const tui: Tui = mode === "interactive" ? new ConsoleTui() : new OpenTui();
  await tui.start();

  try {
    if (mode === "run") {
      await runTask(
        task ?? "Scaffold authentication module and tests",
        tui,
        modelAdapter,
        toolAdapter,
      );
      return;
    }

    tui.renderApprovalPrompt({
      message: "Interactive mode. Type a task. Use 'exit' to quit.",
      options: ["exit"],
    });
    await runInteractive(tui, modelAdapter, toolAdapter);
  } finally {
    tui.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
