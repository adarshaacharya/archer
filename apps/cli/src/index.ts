import { performance } from "node:perf_hooks";
import { runOpenHarnessRuntime } from "@xeq/agent-core";
import { AgentRequestSchema } from "@xeq/shared";
import { PiTui, type Tui } from "@xeq/tui";
import { KeybindManager } from "./keybinds.js";
import { loadTuiConfig } from "./tui-config.js";

function parseInitialTask(argv: string[]): string | null {
  const task = argv.join(" ").trim();
  return task.length > 0 ? task : null;
}

function newSessionId(): string {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

  if (command === "exit" || command === "quit") return { type: "exit" };

  if (command === "help") {
    return {
      type: "continue",
      message: "Commands: /help, /exit, /quit (also: exit, quit)",
    };
  }

  return { type: "continue", message: `Unknown command: ${trimmed}. Try /help` };
}

async function runTask(
  task: string,
  tui: Tui,
  promptOptions: string[],
  model: string,
  sessionId: string,
): Promise<void> {
  const request = AgentRequestSchema.parse({
    task,
    repoRoot: process.cwd(),
    approvalMode: "suggest",
    maxSteps: 6,
    maxDurationMs: 120000,
  });

  tui.renderApprovalPrompt({ message: `> ${request.task}`, options: ["running"] });

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

  const result = await runOpenHarnessRuntime(
    {
      modelId: model,
      sessionId,
      onStep: (step) => {
        tui.renderStep({
          step: step.step,
          action: step.action,
          thought: step.thought,
          observation: step.observation,
        });
      },
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
  keybinds: KeybindManager,
  model: string,
  sessionId: string,
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
      await runTask(line, tui, promptOptions, model, sessionId);
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
  const sessionId = newSessionId();

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
      message: "Interactive mode (openharness). Type a task. Use /exit to quit.",
      options: promptOptions,
    });

    if (initialTask) {
      await runTask(initialTask, tui, promptOptions, model, sessionId);
    }

    await runInteractive(tui, keybinds, model, sessionId);
  } finally {
    tui.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
