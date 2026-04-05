import { performance } from "node:perf_hooks";
import { stdout } from "node:process";
import {
  type AgentMiddleware,
  type ModelAdapter,
  type ToolAdapter,
  runHarness,
} from "@xeq/agent-core";
import {
  type ModelDecisionResponse,
  type ModelProvider,
  type ModelResponse,
  OpenRouterProvider,
} from "@xeq/model-providers";
import { AgentRequestSchema } from "@xeq/shared";
import { createBashToolsExecutor } from "@xeq/tools";
import { PiTui, type Tui } from "@xeq/tui";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { KeybindManager } from "./keybinds.js";
import { loadTuiConfig } from "./tui-config.js";

class StubProvider implements ModelProvider {
  private calls = 0;

  async complete(_messages: ModelMessage[]): Promise<ModelResponse> {
    this.calls += 1;
    if (this.calls >= 3) {
      return { content: "DONE: stub run complete" };
    }
    return { content: `Stub response step ${this.calls}` };
  }

  async decide(_messages: ModelMessage[]): Promise<ModelDecisionResponse> {
    this.calls += 1;
    if (this.calls >= 3) {
      return { content: "stub run complete", toolCalls: [] };
    }

    return {
      content: "",
      toolCalls: [{ name: "bash", input: { command: "ls -la" } }],
    };
  }
}

function parseInitialTask(argv: string[]): string | null {
  const task = argv.join(" ").trim();
  return task.length > 0 ? task : null;
}

function isPlainPrintableInput(char: string): boolean {
  if (char.length !== 1) return false;
  const code = char.charCodeAt(0);
  // Visible ASCII range only; filters protocol fragments like "0u".
  return code >= 32 && code <= 126;
}

type SlashCommandResult =
  | { type: "continue"; message: string }
  | { type: "exit" }
  | { type: "none" };

function handleSlashCommand(input: string): SlashCommandResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { type: "none" };

  const [name] = trimmed.slice(1).split(/\s+/, 1);
  const command = (name ?? "").toLowerCase();

  if (command === "exit" || command === "quit") {
    return { type: "exit" };
  }

  if (command === "help") {
    return {
      type: "continue",
      message: "Commands: /help, /exit, /quit (also: exit, quit)",
    };
  }

  return {
    type: "continue",
    message: `Unknown command: ${trimmed}. Try /help`,
  };
}

function createModelAdapter(provider: ModelProvider): ModelAdapter {
  const bashCallInputSchema = z.object({
    command: z.string().min(1),
  });

  return {
    async decide({ state, signal }) {
      const response = await provider.decide(state.messages as ModelMessage[]);
      if (signal.aborted) {
        throw new Error("run aborted");
      }

      const firstToolCall = response.toolCalls[0];
      if (firstToolCall && firstToolCall.name === "bash") {
        const parsedInput = bashCallInputSchema.safeParse(firstToolCall.input);
        if (parsedInput.success) {
          return {
            type: "tool_call",
            call: { id: firstToolCall.id, name: "bash", input: parsedInput.data },
          };
        }
      }

      return { type: "final", text: response.content.trim() || "Task complete" };
    },
  };
}

async function createToolAdapter(repoRoot: string): Promise<ToolAdapter> {
  const executor = await createBashToolsExecutor({
    uploadDirectory: { source: repoRoot },
  });

  return {
    async execute(call) {
      if (call.name !== "bash") {
        return {
          ok: false,
          error: {
            code: "TOOL_NOT_ALLOWED",
            message: `Only bash tool is allowed. Received: ${call.name}`,
          },
        };
      }

      const result = await executor.executeTool("bash", call.input);
      return {
        ok: result.ok,
        output: result.output ?? "",
        error: result.ok
          ? undefined
          : {
              code: "BASH_TOOL_ERROR",
              message: result.error ?? "bash execution failed",
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
  promptOptions: string[],
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
      options: ["ctrl+c=cancel"],
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
    options: promptOptions,
  });
}

async function runInteractive(
  tui: Tui,
  modelAdapter: ModelAdapter,
  toolAdapter: ToolAdapter,
  keybinds: KeybindManager,
): Promise<void> {
  const promptOptions = [
    `${keybinds.print("input_submit")}=run`,
    `${keybinds.print("input_clear")}=clear`,
    `${keybinds.print("app_exit")}=quit`,
    "/help",
    "/exit",
  ];

  while (true) {
      const line = await tui.readInputLine();
      if (line.length === 0) continue;

      const slash = handleSlashCommand(line);
      if (slash.type === "exit") break;
      if (slash.type === "continue") {
        tui.renderApprovalPrompt({
          message: slash.message,
          options: promptOptions,
        });
        continue;
      }

      if (line === "exit" || line === "quit") break;

      try {
        await runTask(line, tui, modelAdapter, toolAdapter, promptOptions);
      } catch (error) {
        tui.renderApprovalPrompt({
          message: `Run failed: ${error instanceof Error ? error.message : String(error)}`,
          options: ["continue", "exit"],
        });
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
  const toolAdapter = await createToolAdapter(process.cwd());
  const tuiConfig = await loadTuiConfig(process.cwd());
  const keybinds = new KeybindManager(tuiConfig.keybinds);
  const promptOptions = [
    `${keybinds.print("input_submit")}=run`,
    `${keybinds.print("input_clear")}=clear`,
    `${keybinds.print("app_exit")}=quit`,
    "/help",
    "/exit",
  ];

  const tui: Tui = new PiTui();
  await tui.start();

  try {
    tui.renderApprovalPrompt({
      message: "Interactive mode (pi). Type a task. Use /exit to quit.",
      options: promptOptions,
    });

    if (initialTask) {
      await runTask(initialTask, tui, modelAdapter, toolAdapter, promptOptions);
    }

    await runInteractive(tui, modelAdapter, toolAdapter, keybinds);
  } finally {
    tui.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
