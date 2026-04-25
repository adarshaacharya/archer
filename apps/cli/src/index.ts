#!/usr/bin/env bun
import { performance } from "node:perf_hooks";
import { runOpenHarnessRuntime } from "@xeq/agent-core";
import type { SupportedProvider } from "@xeq/model-providers";
import { type ApprovalChoice, type ApprovalRequest, createSandboxEnvironment } from "@xeq/sandbox";
import { AgentRequestSchema } from "@xeq/shared";
import { PiTui, type Tui } from "@xeq/tui";
import { type SupportedWebProvider, createWebSearchProvider } from "@xeq/web";
import {
  clearProviderEnv,
  clearWebProviderEnv,
  defaultModelForProvider,
  getAuthFilePath,
  listSavedProviders,
  listSavedWebProviders,
  normalizeProvider,
  normalizeWebProvider,
  removeProviderAuth,
  removeWebProviderAuth,
  resolveActiveProvider,
  resolveActiveWebProvider,
  saveProviderAuth,
  saveWebProviderAuth,
} from "./auth-store.js";
import { KeybindManager } from "./keybinds.js";
import {
  type PermissionRequest,
  applyApprovalChoice,
  getSettingsFilePath,
  hasStoredPermission,
  readSettings,
  webFetchRuleForUrl,
} from "./settings-store.js";
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

type SessionState = {
  provider: SupportedProvider | null;
  modelId: string;
  authSource: "env" | "saved" | null;
  webProvider: SupportedWebProvider | null;
  webAuthSource: "env" | "saved" | null;
};

type LocalApprovalRequest = ApprovalRequest | PermissionRequest;

function describeApprovalRequest(request: LocalApprovalRequest): string {
  switch (request.kind) {
    case "command":
      return `Allow command?\n${request.target}`;
    case "file-write":
      return `Allow file write?\n${request.target}`;
    case "web-fetch":
      return `Allow web fetch?\n${request.target}`;
  }
}

async function requestApproval(tui: Tui, request: LocalApprovalRequest): Promise<ApprovalChoice> {
  const settings = await readSettings();
  if (hasStoredPermission(settings, request)) {
    return "always";
  }

  while (true) {
    tui.renderApprovalPrompt({
      message: describeApprovalRequest(request),
      options: ["y=once", "a=always", "n=reject"],
    });

    const input = (await tui.readInputLine()).trim().toLowerCase();
    if (input === "y" || input === "yes" || input === "once") {
      return "once";
    }
    if (input === "a" || input === "always") {
      await applyApprovalChoice(request, "always");
      return "always";
    }
    if (input === "n" || input === "no" || input === "reject") {
      return "reject";
    }

    tui.renderApprovalPrompt({
      message: "Enter y, a, or n",
      options: ["y=once", "a=always", "n=reject"],
    });
  }
}

async function permissionsSummary(): Promise<string> {
  const settings = await readSettings();
  return [
    `file_writes=${settings.permissions.fileWriteAllowRules.length}`,
    `commands=${settings.permissions.commandAllowRules.length}`,
    `web_fetch=${settings.permissions.webFetchAllowRules.length}`,
    `store=${getSettingsFilePath()}`,
  ].join("  ");
}

function activeProviderSummary(state: SessionState): string {
  if (!state.provider || !state.authSource) {
    return "provider=unconfigured";
  }

  return `provider=${state.provider}  model=${state.modelId}  auth=${state.authSource}`;
}

function updateSessionState(
  state: SessionState,
  resolved: Awaited<ReturnType<typeof resolveActiveProvider>>,
): void {
  if (!resolved) {
    state.provider = null;
    state.modelId = "";
    state.authSource = null;
    return;
  }

  state.provider = resolved.provider;
  state.modelId = resolved.modelId;
  state.authSource = resolved.authSource;
}

function activeWebProviderSummary(state: SessionState): string {
  if (!state.webProvider || !state.webAuthSource) {
    return "web=unconfigured";
  }

  return `web=${state.webProvider}  auth=${state.webAuthSource}`;
}

function updateWebSessionState(
  state: SessionState,
  resolved: Awaited<ReturnType<typeof resolveActiveWebProvider>>,
): void {
  if (!resolved) {
    state.webProvider = null;
    state.webAuthSource = null;
    return;
  }

  state.webProvider = resolved.provider;
  state.webAuthSource = resolved.authSource;
}

async function runTask(
  task: string,
  tui: Tui,
  promptOptions: string[],
  state: SessionState,
  sessionId: string,
): Promise<void> {
  const abortController = new AbortController();
  tui.onCancelRunning(() => {
    abortController.abort();
    tui.renderApprovalPrompt({
      message: "Cancelling current run...",
      options: ["wait"],
    });
  });

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
  let promptPending = false;
  const spinner = setInterval(() => {
    if (promptPending) {
      return;
    }

    const frame = spinnerFrames[frameIndex % spinnerFrames.length];
    frameIndex += 1;
    tui.renderApprovalPrompt({
      message: `${frame} Processing task...`,
      options: ["esc=abort"],
    });
  }, 120);

  const env = createSandboxEnvironment({
    cwd: request.repoRoot,
    approvals: async (approvalRequest) => {
      promptPending = true;
      try {
        return await requestApproval(tui, approvalRequest);
      } finally {
        promptPending = false;
      }
    },
  });

  const webSearch = createWebSearchProvider(
    async () => {
      promptPending = true;
      try {
        const connected = await ensureWebProviderConnected(tui, state);
        if (!connected) {
          throw new Error("Web search cancelled: no provider configured");
        }

        const resolved = await resolveActiveWebProvider();
        updateWebSessionState(state, resolved);
        if (!resolved) {
          throw new Error("Web search is unavailable");
        }

        return {
          provider: resolved.provider,
          apiKey: resolved.apiKey,
        };
      } finally {
        promptPending = false;
      }
    },
    {
      allowUrl: async (url) => {
        const rule = webFetchRuleForUrl(url);
        if (!rule) {
          throw new Error(`Invalid URL for web fetch: ${url}`);
        }

        promptPending = true;
        try {
          const approval = await requestApproval(tui, {
            kind: "web-fetch",
            target: rule,
          });
          if (approval === "reject") {
            throw new Error(`Web fetch denied for ${rule}`);
          }
        } finally {
          promptPending = false;
        }
      },
    },
  );

  const result = await runOpenHarnessRuntime(
    {
      modelId: state.modelId,
      sessionId,
      providers: {
        ...env,
        webSearch,
      },
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
      abortSignal: abortController.signal,
    },
  ).finally(() => {
    clearInterval(spinner);
    tui.onCancelRunning(null);
  });

  tui.renderSummary({
    success: result.status === "completed" || result.status === "cancelled",
    steps: result.steps,
    durationMs: Math.round(performance.now() - started),
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
  });

  tui.renderApprovalPrompt({
    message: result.status === "cancelled" ? "> Run cancelled. Type next task" : "> Type next task",
    options: promptOptions,
  });
}

async function promptForProvider(tui: Tui): Promise<SupportedProvider | "exit"> {
  while (true) {
    tui.renderApprovalPrompt({
      message: "No provider configured. Enter provider: openai, anthropic, gemini, openrouter",
      options: ["/exit"],
    });
    const value = (await tui.readInputLine()).trim();
    if (!value) continue;
    if (value === "/exit" || value === "/quit" || value === "/bye") return "exit";

    const provider = normalizeProvider(value);
    if (provider) return provider;

    tui.renderApprovalPrompt({
      message: `Unknown provider: ${value}`,
      options: ["openai", "anthropic", "gemini", "openrouter"],
    });
  }
}

async function promptForWebProvider(tui: Tui): Promise<SupportedWebProvider | "skip" | "exit"> {
  while (true) {
    tui.renderApprovalPrompt({
      message: "No web search provider configured. Enter provider: tavily, exa, or skip",
      options: ["tavily", "exa", "skip", "/exit"],
    });
    const value = (await tui.readInputLine()).trim();
    if (!value) continue;
    if (value === "/exit" || value === "/quit" || value === "/bye") return "exit";
    if (value.toLowerCase() === "skip") return "skip";

    const provider = normalizeWebProvider(value);
    if (provider) return provider;

    tui.renderApprovalPrompt({
      message: `Unknown web provider: ${value}`,
      options: ["tavily", "exa", "skip"],
    });
  }
}

async function connectProvider(
  tui: Tui,
  state: SessionState,
  provider?: SupportedProvider,
): Promise<SlashCommandResult> {
  const selectedProvider = provider ?? (await promptForProvider(tui));
  if (selectedProvider === "exit") return { type: "exit" };

  while (true) {
    tui.renderApprovalPrompt({
      message: `Enter API key for ${selectedProvider}`,
      options: ["/exit"],
    });
    const key = (await tui.readInputLine()).trim();
    if (!key) continue;
    if (key === "/exit" || key === "/quit" || key === "/bye") return { type: "exit" };

    await saveProviderAuth(selectedProvider, key);
    process.env.XEQ_PROVIDER = selectedProvider;
    process.env.AGENT_MODEL = defaultModelForProvider(selectedProvider);
    switch (selectedProvider) {
      case "openai":
        process.env.OPENAI_API_KEY = key;
        break;
      case "anthropic":
        process.env.ANTHROPIC_API_KEY = key;
        break;
      case "gemini":
        process.env.GEMINI_API_KEY = key;
        break;
      default:
        process.env.OPENROUTER_API_KEY = key;
        break;
    }

    const resolved = await resolveActiveProvider();
    updateSessionState(state, resolved);
    return {
      type: "continue",
      message: `Connected ${selectedProvider}. ${activeProviderSummary(state)}`,
    };
  }
}

async function ensureProviderConnected(tui: Tui, state: SessionState): Promise<boolean> {
  const resolved = await resolveActiveProvider();
  updateSessionState(state, resolved);

  if (state.provider && state.authSource) {
    return true;
  }

  const result = await connectProvider(tui, state);
  return result.type !== "exit";
}

async function connectWebProvider(
  tui: Tui,
  state: SessionState,
  provider?: SupportedWebProvider,
): Promise<SlashCommandResult> {
  const selectedProvider = provider ?? (await promptForWebProvider(tui));
  if (selectedProvider === "exit") return { type: "exit" };
  if (selectedProvider === "skip") {
    return { type: "continue", message: "Skipped web provider setup." };
  }

  while (true) {
    tui.renderApprovalPrompt({
      message: `Enter API key for ${selectedProvider}`,
      options: ["/exit"],
    });
    const key = (await tui.readInputLine()).trim();
    if (!key) continue;
    if (key === "/exit" || key === "/quit" || key === "/bye") return { type: "exit" };

    await saveWebProviderAuth(selectedProvider, key);
    process.env.XEQ_WEB_PROVIDER = selectedProvider;
    if (selectedProvider === "exa") {
      process.env.EXA_API_KEY = key;
    } else {
      process.env.TAVILY_API_KEY = key;
    }

    const resolved = await resolveActiveWebProvider();
    updateWebSessionState(state, resolved);
    return {
      type: "continue",
      message: `Connected ${selectedProvider}. ${activeWebProviderSummary(state)}`,
    };
  }
}

async function ensureWebProviderConnected(tui: Tui, state: SessionState): Promise<boolean> {
  const resolved = await resolveActiveWebProvider();
  updateWebSessionState(state, resolved);

  if (state.webProvider && state.webAuthSource) {
    return true;
  }

  const result = await connectWebProvider(tui, state);
  return result.type !== "exit" && state.webProvider !== null;
}

async function handleSlashCommand(
  input: string,
  tui: Tui,
  state: SessionState,
): Promise<SlashCommandResult> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { type: "none" };

  const [name] = trimmed.slice(1).split(/\s+/, 1);
  const command = (name ?? "").toLowerCase();

  if (command === "exit" || command === "quit" || command === "bye") return { type: "exit" };

  if (command === "help") {
    return {
      type: "continue",
      message:
        "Commands: /help, /connect, /provider, /web, /web-provider, /web-logout, /permissions, /logout, /bye, /exit",
    };
  }

  if (command === "provider") {
    const saved = await listSavedProviders();
    const savedText = saved.length > 0 ? `saved=${saved.join(", ")}` : "saved=none";
    return {
      type: "continue",
      message: `${activeProviderSummary(state)}  ${savedText}  store=${getAuthFilePath()}`,
    };
  }

  if (command === "permissions") {
    return {
      type: "continue",
      message: await permissionsSummary(),
    };
  }

  if (command === "connect") {
    return connectProvider(tui, state);
  }

  if (command === "web") {
    return connectWebProvider(tui, state);
  }

  if (command === "web-provider") {
    const saved = await listSavedWebProviders();
    const savedText = saved.length > 0 ? `saved=${saved.join(", ")}` : "saved=none";
    return {
      type: "continue",
      message: `${activeWebProviderSummary(state)}  ${savedText}  store=${getAuthFilePath()}`,
    };
  }

  if (command === "web-logout") {
    if (!state.webProvider) {
      return { type: "continue", message: "No active web provider to log out." };
    }

    if (state.webAuthSource !== "saved") {
      return {
        type: "continue",
        message: `Current web provider ${state.webProvider} is coming from env. Remove the env var manually.`,
      };
    }

    await removeWebProviderAuth(state.webProvider);
    clearWebProviderEnv(state.webProvider);
    const resolved = await resolveActiveWebProvider();
    updateWebSessionState(state, resolved);
    return {
      type: "continue",
      message: state.webProvider
        ? `Logged out. Switched to ${activeWebProviderSummary(state)}`
        : "Logged out current web provider.",
    };
  }

  if (command === "logout") {
    if (!state.provider) {
      return { type: "continue", message: "No active provider to log out." };
    }

    if (state.authSource !== "saved") {
      return {
        type: "continue",
        message: `Current provider ${state.provider} is coming from env. Remove the env var manually.`,
      };
    }

    await removeProviderAuth(state.provider);
    clearProviderEnv(state.provider);
    const resolved = await resolveActiveProvider();
    updateSessionState(state, resolved);

    if (state.provider && state.authSource) {
      return {
        type: "continue",
        message: `Logged out. Switched to ${activeProviderSummary(state)}`,
      };
    }

    const reconnected = await ensureProviderConnected(tui, state);
    if (!reconnected) {
      return { type: "exit" };
    }

    return {
      type: "continue",
      message: `Logged out. Connected ${activeProviderSummary(state)}`,
    };
  }

  return { type: "continue", message: `Unknown command: ${trimmed}. Try /help` };
}

async function runInteractive(
  tui: Tui,
  keybinds: KeybindManager,
  state: SessionState,
  sessionId: string,
): Promise<void> {
  const promptOptions = [
    `${keybinds.print("input_submit")}=run`,
    `${keybinds.print("input_clear")}=clear`,
    `${keybinds.print("app_exit")}=quit`,
    "/connect",
    "/provider",
    "/web",
    "/web-provider",
    "/web-logout",
    "/permissions",
    "/logout",
    "/help",
    "/bye",
  ];

  while (true) {
    const line = await tui.readInputLine();
    if (line.length === 0) continue;

    const slash = await handleSlashCommand(line, tui, state);
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
      await runTask(line, tui, promptOptions, state, sessionId);
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
  const sessionId = newSessionId();
  const state: SessionState = {
    provider: null,
    modelId: "",
    authSource: null,
    webProvider: null,
    webAuthSource: null,
  };

  const tuiConfig = await loadTuiConfig(process.cwd());
  const keybinds = new KeybindManager(tuiConfig.keybinds);
  const promptOptions = [
    `${keybinds.print("input_submit")}=run`,
    `${keybinds.print("input_clear")}=clear`,
    `${keybinds.print("app_exit")}=quit`,
    "/connect",
    "/provider",
    "/web",
    "/web-provider",
    "/web-logout",
    "/permissions",
    "/logout",
    "/help",
    "/bye",
  ];

  const tui: Tui = new PiTui();
  await tui.start();

  try {
    const ready = await ensureProviderConnected(tui, state);
    if (!ready) return;

    tui.renderApprovalPrompt({
      message: `Interactive mode (openharness). ${activeProviderSummary(state)}`,
      options: promptOptions,
    });

    if (initialTask) {
      await runTask(initialTask, tui, promptOptions, state, sessionId);
    }

    await runInteractive(tui, keybinds, state, sessionId);
  } finally {
    tui.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
