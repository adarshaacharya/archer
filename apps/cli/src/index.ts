import { performance } from "node:perf_hooks";
import { stdin, stdout } from "node:process";
import { emitKeypressEvents } from "node:readline";
import {
  type AgentMiddleware,
  type ModelAdapter,
  type ToolAdapter,
  runHarness,
} from "@xeq/agent-core";
import { type ModelProvider, type ModelResponse, OpenRouterProvider } from "@xeq/model-providers";
import { AgentRequestSchema } from "@xeq/shared";
import { OpenTui, type Tui } from "@xeq/tui";
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

function parseInitialTask(argv: string[]): string | null {
  const task = argv.join(" ").trim();
  return task.length > 0 ? task : null;
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

  tui.renderApprovalPrompt({ message: `> ${request.task}`, options: ["running"] });

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
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;
  const spinner = setInterval(() => {
    const frame = spinnerFrames[frameIndex % spinnerFrames.length];
    frameIndex += 1;
    tui.renderApprovalPrompt({
      message: `${frame} Processing task...`,
      options: ["enter=queue next", "exit=quit"],
    });
  }, 120);

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
  ).finally(() => {
    clearInterval(spinner);
  });

  tui.renderSummary({
    success: result.status === "completed",
    steps: result.steps,
    durationMs: Math.round(performance.now() - started),
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
  });
  tui.renderApprovalPrompt({
    message: "> Type next task",
    options: ["enter=send", "exit=quit"],
  });
}

async function runInteractive(
  tui: Tui,
  modelAdapter: ModelAdapter,
  toolAdapter: ToolAdapter,
): Promise<void> {
  emitKeypressEvents(stdin);
  const canUseRawMode = stdin.isTTY && typeof stdin.setRawMode === "function";
  if (canUseRawMode) {
    stdin.setRawMode(true);
  }
  stdin.resume();

  const readInputLine = () =>
    new Promise<string>((resolve, reject) => {
      let buffer = "";
      tui.renderApprovalPrompt({
        message: `> ${buffer}`,
        options: ["enter=send", "exit=quit"],
      });

      const onKeypress = (char: string, key: { name?: string; ctrl?: boolean }) => {
        if (key.ctrl && key.name === "c") {
          stdin.off("keypress", onKeypress);
          reject(new Error("cancelled"));
          return;
        }

        if (key.name === "return" || key.name === "enter") {
          stdin.off("keypress", onKeypress);
          resolve(buffer.trim());
          return;
        }

        if (key.name === "backspace") {
          buffer = buffer.slice(0, -1);
          tui.renderApprovalPrompt({
            message: `> ${buffer}`,
            options: ["enter=send", "exit=quit"],
          });
          return;
        }

        if (char && !key.ctrl) {
          buffer += char;
          tui.renderApprovalPrompt({
            message: `> ${buffer}`,
            options: ["enter=send", "exit=quit"],
          });
        }
      };

      stdin.on("keypress", onKeypress);
    });

  try {
    while (true) {
      const line = await readInputLine();
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
    if (canUseRawMode) {
      stdin.setRawMode(false);
    }
  }
}

async function main(): Promise<void> {
  const initialTask = parseInitialTask(process.argv.slice(2));
  const model = process.env.AGENT_MODEL ?? "openai/gpt-4o-mini";
  const apiKey = process.env.OPENROUTER_API_KEY;

  const provider: ModelProvider = apiKey
    ? new OpenRouterProvider(model, apiKey)
    : new StubProvider();
  const modelAdapter = createModelAdapter(provider);
  const toolAdapter = createToolAdapter();

  const tui: Tui = new OpenTui();
  await tui.start();

  try {
    tui.renderApprovalPrompt({
      message: "Interactive mode. Type a task. Use 'exit' to quit.",
      options: ["exit"],
    });

    if (initialTask) {
      await runTask(initialTask, tui, modelAdapter, toolAdapter);
    }

    await runInteractive(tui, modelAdapter, toolAdapter);
  } finally {
    tui.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
