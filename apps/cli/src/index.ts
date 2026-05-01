#!/usr/bin/env bun
import "./ai-sdk-warnings.js";
import { performance } from "node:perf_hooks";
import { runOpenHarnessRuntime } from "@xeq/agent-core";
import type { SupportedProvider } from "@xeq/model-providers";
import { createSandboxEnvironment } from "@xeq/sandbox";
import { type ApprovalMode, AgentRequestSchema } from "@xeq/shared";
import {
  appendMessage,
  createSession,
  getMessages,
  getSession,
  listSessions,
  updateSessionTitle,
} from "@xeq/storage";
import { PiTui, type SlashCommandItem, type Tui } from "@xeq/tui";
import { type SupportedWebProvider, createWebSearchProvider } from "@xeq/web";
import {
  permissionsSummary,
  requestApproval,
  setApprovalMode,
  withApprovalQueue,
} from "./approvals.js";
import {
  clearProviderEnv,
  clearWebProviderEnv,
  defaultModelForProvider,
  getAuthFilePath,
  listAvailableProviders,
  listProviderStatuses,
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
import { commitSlashCommandItem, commitWorkflowPrompt } from "./commands/commit.js";
import { KeybindManager } from "./keybinds.js";
import { MODEL_CHOICES_BY_PROVIDER, PROVIDER_CHOICES } from "./model-picker-options.js";
import {
  webFetchRuleForUrl,
} from "./settings-store.js";
import { createToolApprovalHandler } from "./tool-approval.js";
import { loadTuiConfig } from "./tui-config.js";

function parseInitialTask(argv: string[]): string | null {
  const task = argv.join(" ").trim();
  return task.length > 0 ? task : null;
}

function newSessionId(): string {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function titleFromTask(task: string): string {
  return task.replace(/\s+/g, " ").trim().slice(0, 80);
}

function newMessageId(sessionId: string, role: string): string {
  return `${sessionId}_${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolveProjectRoot(startDir: string): string {
  const result = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--show-toplevel"],
    cwd: startDir,
    stdout: "pipe",
    stderr: "ignore",
  });

  if (result.exitCode === 0) {
    const root = new TextDecoder().decode(result.stdout).trim();
    if (root) {
      return root;
    }
  }

  return startDir;
}

type SlashCommandResult =
  | {
      type: "continue";
      message: string;
      lines?: Array<{ text: string; color?: string }>;
      restoreSessionId?: string;
    }
  | { type: "exit" }
  | { type: "none" };

type SessionState = {
  sessionId: string;
  sessionTitle: string | null;
  projectRoot: string;
  approvalMode: ApprovalMode;
  provider: SupportedProvider | null;
  modelId: string;
  authSource: "env" | "saved" | null;
  webProvider: SupportedWebProvider | null;
  webAuthSource: "env" | "saved" | null;
};

function activeProviderSummary(state: SessionState): string {
  if (!state.provider || !state.authSource) {
    return "provider=unconfigured";
  }

  return `provider=${state.provider}  model=${state.modelId}  auth=${state.authSource}`;
}

function normalizeModelIdForProvider(provider: SupportedProvider, modelId: string): string {
  const value = modelId.trim();
  switch (provider) {
    case "openai":
      return value.replace(/^openai\//, "");
    case "anthropic":
      return value.replace(/^anthropic\//, "");
    case "gemini":
      return value.replace(/^(google|gemini)\//, "");
    default:
      return value;
  }
}

function modelChoiceIndex(provider: SupportedProvider, modelId: string): number {
  const normalized = normalizeModelIdForProvider(provider, modelId);
  const choices = MODEL_CHOICES_BY_PROVIDER[provider];
  const index = choices.findIndex((choice) => choice.value === normalized);
  const defaultIndex = choices.findIndex(
    (choice) => choice.value === defaultModelForProvider(provider),
  );
  return index >= 0 ? index : Math.max(0, defaultIndex);
}

type ModelSelection = {
  provider: SupportedProvider;
  modelId: string;
};

const CONNECT_PROVIDER_VALUE = "__connect_provider__";

function providerLabel(provider: SupportedProvider): string {
  return PROVIDER_CHOICES.find((choice) => choice.value === provider)?.label ?? provider;
}

function modelSelectionValue(selection: ModelSelection): string {
  return `${selection.provider}::${selection.modelId}`;
}

function parseModelSelectionValue(value: string): ModelSelection | null {
  const [provider, ...rest] = value.split("::");
  if (!provider) return null;
  const normalizedProvider = normalizeProvider(provider);
  if (!normalizedProvider || rest.length === 0) return null;
  return {
    provider: normalizedProvider,
    modelId: rest.join("::"),
  };
}

function parseModelInput(currentProvider: SupportedProvider, input: string): ModelSelection {
  const trimmed = input.trim();
  const [prefix, ...rest] = trimmed.split("/");
  const explicitProvider = prefix ? normalizeProvider(prefix) : null;
  if (explicitProvider && rest.length > 0) {
    const modelId = explicitProvider === "openrouter" ? trimmed : rest.join("/");
    return {
      provider: explicitProvider,
      modelId: normalizeModelIdForProvider(explicitProvider, modelId),
    };
  }

  return {
    provider: currentProvider,
    modelId: normalizeModelIdForProvider(currentProvider, trimmed),
  };
}

async function promptForModel(
  tui: Tui,
  state: SessionState,
): Promise<ModelSelection | "connect-provider" | "exit" | "cancel"> {
  const currentProvider = state.provider ?? "openrouter";
  const currentModel = normalizeModelIdForProvider(
    currentProvider,
    state.modelId || defaultModelForProvider(currentProvider),
  );
  const availableProviders = await listAvailableProviders();
  const providers =
    availableProviders.length > 0
      ? Array.from(new Set([currentProvider, ...availableProviders]))
      : [currentProvider];
  const catalog = providers.flatMap((provider) =>
    MODEL_CHOICES_BY_PROVIDER[provider].map((choice) => ({
      provider,
      modelId: choice.value,
      label: choice.label,
      description: choice.description,
    })),
  );
  const selectedIndex = Math.max(
    0,
    catalog.findIndex(
      (choice) => choice.provider === currentProvider && choice.modelId === currentModel,
    ),
  );
  const selected = await tui.promptApproval({
    message: "Choose model",
    details: `Providers: ${providers.map(providerLabel).join(", ")}  Current: ${providerLabel(currentProvider)}/${currentModel}`,
    selectedIndex,
    choices: [
      ...catalog.map((choice) => ({
        value: modelSelectionValue({
          provider: choice.provider,
          modelId: choice.modelId,
        }),
        label: `${choice.label}  [${providerLabel(choice.provider)}]`,
        description: choice.description,
      })),
      {
        value: CONNECT_PROVIDER_VALUE,
        label: "Connect provider...",
        description: "Add or update another provider API key",
      },
    ],
  });
  if (selected === "reject") return "cancel";
  if (selected === CONNECT_PROVIDER_VALUE) return "connect-provider";

  return parseModelSelectionValue(selected) ?? "cancel";
}

async function setModel(
  tui: Tui,
  state: SessionState,
  modelId?: string,
): Promise<SlashCommandResult> {
  const currentProvider = state.provider ?? "openrouter";
  let selection: ModelSelection | "connect-provider" | "exit" | "cancel" =
    modelId && modelId.trim().length > 0
      ? parseModelInput(currentProvider, modelId)
      : await promptForModel(tui, state);

  while (selection === "connect-provider") {
    const result = await connectProvider(tui, state);
    if (result.type === "exit") return result;
    selection = await promptForModel(tui, state);
  }

  if (selection === "exit") return { type: "exit" };
  if (selection === "cancel") return { type: "continue", message: "Model selection cancelled." };

  const previousProvider = process.env.XEQ_PROVIDER;
  const previousModel = process.env.AGENT_MODEL;
  process.env.XEQ_PROVIDER = selection.provider;
  process.env.AGENT_MODEL = selection.modelId;

  const resolved = await resolveActiveProvider();
  if (!resolved || resolved.provider !== selection.provider) {
    if (previousProvider) process.env.XEQ_PROVIDER = previousProvider;
    else process.env.XEQ_PROVIDER = undefined;
    if (previousModel) process.env.AGENT_MODEL = previousModel;
    else process.env.AGENT_MODEL = undefined;
    return {
      type: "continue",
      message: `Provider ${selection.provider} is not connected. Use /connect ${selection.provider} first.`,
    };
  }

  updateSessionState(state, resolved);
  tui.setActiveModel(state.modelId);
  return {
    type: "continue",
    message: `Model set to ${state.provider}/${state.modelId}. ${activeProviderSummary(state)}`,
  };
}

async function providersSummary(
  state: SessionState,
): Promise<Array<{ text: string; color?: string }>> {
  const statuses = await listProviderStatuses();
  const lines = statuses.map((item) => {
    const parts = [
      state.provider === item.provider ? "active" : null,
      item.saved ? "saved" : null,
      !item.saved && item.env ? "env only" : null,
      !item.available ? "not connected" : null,
    ].filter(Boolean);
    const status = parts.join(", ");
    return {
      text: `${providerLabel(item.provider)}: ${status}`,
      color: item.available ? "#3FB950" : "#D29922",
    };
  });
  const activeLine =
    state.provider && state.modelId
      ? `Active model: ${providerLabel(state.provider)}/${state.modelId}`
      : "Active model: unconfigured";
  return [
    { text: "Providers", color: "#E6EDF3" },
    { text: activeLine, color: "#6E7681" },
    ...lines,
    { text: `Store: ${getAuthFilePath()}`, color: "#6E7681" },
  ];
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

async function runTask(task: string, tui: Tui, state: SessionState): Promise<void> {
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
    repoRoot: state.projectRoot,
    approvalMode: state.approvalMode,
    maxSteps: 256,
    maxDurationMs: 120000,
  });

  if (!state.sessionTitle) {
    state.sessionTitle = titleFromTask(request.task);
    await updateSessionTitle({
      id: state.sessionId,
      title: state.sessionTitle,
    });
  }

  tui.renderApprovalPrompt({ message: request.task, options: ["running"] });

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

  const patchApprovedPaths = new Set<string>();

  const env = createSandboxEnvironment({
    cwd: request.repoRoot,
    approvals: async (approvalRequest) => {
      if (approvalRequest.kind === "file-write" && patchApprovedPaths.has(approvalRequest.target)) {
        patchApprovedPaths.delete(approvalRequest.target);
        return "once";
      }
      promptPending = true;
      try {
        return await requestApproval(tui, approvalRequest);
      } finally {
        promptPending = false;
      }
    },
  });

  tui.renderUserMessage(request.task);
  await appendMessage({
    id: newMessageId(state.sessionId, "user"),
    session_id: state.sessionId,
    role: "user",
    kind: "transcript",
    content: request.task,
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
      sessionId: state.sessionId,
      providers: {
        ...env,
        webSearch,
      },
      approveToolCall: createToolApprovalHandler({
        approvalMode: state.approvalMode,
        patchApprovedPaths,
        requestApproval: async (approvalRequest) => {
          promptPending = true;
          try {
            return await requestApproval(tui, approvalRequest);
          } finally {
            promptPending = false;
          }
        },
      }),
      approvePatchApply: async (preview) => {
        if (state.approvalMode === "auto-edit") {
          if (preview.files) {
            for (const f of preview.files) {
              patchApprovedPaths.add(f.filePath);
            }
          } else if (preview.filePath) {
            patchApprovedPaths.add(preview.filePath);
          }
          return true;
        }

        promptPending = true;
        try {
          const approval = await withApprovalQueue(() =>
            tui.promptApproval({
              message: "Review changes",
              details: preview.summary ? preview.summary : "Inspect the patch before applying.",
              review:
                preview.files && preview.files.length > 0
                  ? {
                      summary: preview.summary ?? "Prepared changes",
                      changedFilesCount: preview.changedFilesCount ?? preview.files.length,
                      files: preview.files,
                    }
                  : undefined,
              choices: [
                {
                  value: "reject",
                  label: "Reject",
                  description: "Deny these changes",
                },
                {
                  value: "once",
                  label: "Approve once",
                  description: "Apply these changes this time only",
                },
                {
                  value: "always",
                  label: "Always approve",
                  description: "Remember this approval choice",
                },
              ],
            }),
          );
          if (approval !== "reject" && preview.files) {
            for (const f of preview.files) {
              patchApprovedPaths.add(f.filePath);
            }
          }
          return approval !== "reject";
        } finally {
          promptPending = false;
        }
      },
      onStep: (step) => {
        if (step.action === "model.final") {
          tui.finalizeAssistantStream(step.observation);
          if (step.observation?.trim()) {
            void appendMessage({
              id: newMessageId(state.sessionId, "assistant"),
              session_id: state.sessionId,
              role: "assistant",
              kind: "transcript",
              content: step.observation,
            });
          }
          return;
        }

        tui.renderStep({
          step: step.step,
          action: step.action,
          thought: step.thought,
          observation: step.observation,
        });
      },
      onTextDelta: (delta) => {
        tui.renderAssistantDelta(delta);
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
    promptTokens: result.usage?.promptTokens ?? 0,
    completionTokens: result.usage?.completionTokens ?? 0,
    estimatedCostUsd: result.estimatedCostUsd ?? 0,
  });

  tui.renderApprovalPrompt(null);
}

function formatTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp) {
    return "unknown";
  }

  return new Date(timestamp).toLocaleString();
}

function sessionLabel(
  session: Awaited<ReturnType<typeof listSessions>>[number],
  index?: number,
): string {
  const prefix = index === undefined ? "" : `${index + 1}. `;
  const stamp = formatTimestamp(session.updated_at);
  const title = session.title?.trim() || "Untitled";
  return `${prefix}${title}  ${stamp}`;
}

function sessionDescription(session: Awaited<ReturnType<typeof listSessions>>[number]): string {
  return `updated=${formatTimestamp(session.updated_at)}  id=${session.id}`;
}

async function projectSessions() {
  return listSessions({
    limit: 50,
    project_root: resolveProjectRoot(process.cwd()),
  });
}

async function historySummary(): Promise<Array<{ text: string; color?: string }>> {
  const sessions = await projectSessions();

  if (sessions.length === 0) {
    return [{ text: "No stored sessions for this project yet.", color: "#6E7681" }];
  }

  return sessions.map((session, index) => ({
    text: `${sessionLabel(session, index)}  ${sessionDescription(session)}`,
    color: session.id.startsWith("session_") ? "#E6EDF3" : "#6E7681",
  }));
}

function renderStoredContent(content: string): string {
  const renderPart = (part: unknown): string[] => {
    if (typeof part === "string") {
      return [part];
    }

    if (!part || typeof part !== "object") {
      return [];
    }

    const record = part as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : null;

    if ((type === "reasoning" || type === "reasoning_text") && typeof record.text === "string") {
      return [`[reasoning] ${record.text}`];
    }

    if (type === "text" && typeof record.text === "string") {
      return [record.text];
    }

    if (type === "text" && typeof record.value === "string") {
      return [record.value];
    }

    if ((type === "tool-call" || type === "tool_call") && typeof record.toolName === "string") {
      const input =
        record.input === undefined ? "" : ` ${JSON.stringify(record.input).slice(0, 240)}`;
      return [`[tool-call:${record.toolName}]${input}`];
    }

    if ((type === "tool-result" || type === "tool_result") && typeof record.toolName === "string") {
      const output =
        record.output === undefined ? "" : ` ${JSON.stringify(record.output).slice(0, 240)}`;
      return [`[tool-result:${record.toolName}]${output}`];
    }

    if ((type === "image" || type === "file") && typeof record.mimeType === "string") {
      return [`[${type}:${record.mimeType}]`];
    }

    if (type === "file") {
      return ["[file]"];
    }

    if (type) {
      return [`[${type}]`];
    }

    if (typeof record.text === "string") {
      return [record.text];
    }

    return [];
  };

  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === "string") {
      return parsed;
    }

    if (Array.isArray(parsed)) {
      const parts = parsed.flatMap((item) => renderPart(item));
      const visibleParts = parts.some((part) => !part.startsWith("[reasoning]"))
        ? parts.filter((part) => !part.startsWith("[reasoning]"))
        : parts;

      if (visibleParts.length > 0) {
        return visibleParts.join("\n");
      }
    }

    if (parsed && typeof parsed === "object") {
      const lines = renderPart(parsed);
      if (lines.length > 0) {
        return lines.join("\n");
      }
    }
  } catch {
    return content;
  }

  return content;
}

async function pickSession(tui: Tui, prompt: string): Promise<string | "cancel"> {
  const sessions = await projectSessions();
  if (sessions.length === 0) {
    return "cancel";
  }

  const picked = await tui.promptApproval({
    message: prompt,
    choices: sessions.map((session) => ({
      value: session.id,
      label: sessionLabel(session),
      description: sessionDescription(session),
    })),
  });

  if (picked === "reject") {
    return "cancel";
  }

  return picked;
}

async function continueSession(
  sessionId: string,
  state: SessionState,
): Promise<SlashCommandResult> {
  const session = await getSession(sessionId);
  if (!session) {
    return {
      type: "continue",
      message: `Unknown session: ${sessionId}`,
    };
  }

  state.sessionId = session.id;
  state.sessionTitle = session.title ?? null;
  return {
    type: "continue",
    message: "",
    restoreSessionId: session.id,
  };
}

async function startNewSession(state: SessionState): Promise<SlashCommandResult> {
  const sessionId = newSessionId();
  await createSession({
    id: sessionId,
    title: null,
    cwd: process.cwd(),
    project_root: state.projectRoot,
    provider: state.provider ?? "unknown",
    model: state.modelId || "unknown",
  });

  state.sessionId = sessionId;
  state.sessionTitle = null;
  return {
    type: "continue",
    message: "Started a new session.",
  };
}

async function promptForProvider(
  tui: Tui,
  currentProvider: SupportedProvider | null,
): Promise<SupportedProvider | "exit" | "cancel"> {
  const selected = await tui.promptApproval({
    message: "Choose model provider",
    selectedIndex: Math.max(
      0,
      PROVIDER_CHOICES.findIndex((choice) => choice.value === currentProvider),
    ),
    choices: PROVIDER_CHOICES.map((choice) => ({
      value: choice.value,
      label: choice.label,
      description: choice.description,
    })),
  });
  if (selected === "reject") return "cancel";

  const provider = normalizeProvider(selected);
  return provider ?? "exit";
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
  const previousProvider = state.provider;
  const selectedProvider = provider ?? (await promptForProvider(tui, state.provider));
  if (selectedProvider === "exit") return { type: "exit" };
  if (selectedProvider === "cancel") {
    return { type: "continue", message: "Provider selection cancelled." };
  }

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
    if (selectedProvider !== previousProvider) {
      process.env.AGENT_MODEL = defaultModelForProvider(selectedProvider);
    } else {
      process.env.AGENT_MODEL ??= defaultModelForProvider(selectedProvider);
    }
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
    tui.setActiveModel(state.modelId);
    return {
      type: "continue",
      message: `Connected ${selectedProvider}. ${activeProviderSummary(state)}`,
    };
  }
}

async function ensureProviderConnected(tui: Tui, state: SessionState): Promise<boolean> {
  const resolved = await resolveActiveProvider();
  updateSessionState(state, resolved);
  tui.setActiveModel(state.modelId);

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

async function replaySessionTranscript(tui: Tui, sessionId: string): Promise<void> {
  const messages = await getMessages(sessionId);
  if (messages.length === 0) {
    tui.renderInfoMessage(`No stored messages for ${sessionId}.`);
    return;
  }

  tui.renderInfoMessage(
    `Restored ${messages.length} stored message${messages.length === 1 ? "" : "s"} from ${sessionId}.`,
  );

  for (const message of messages) {
    const content = renderStoredContent(message.content);
    if (!content.trim()) {
      continue;
    }

    if (message.role === "user") {
      tui.renderUserMessage(content);
      continue;
    }

    if (message.role === "assistant") {
      tui.finalizeAssistantStream(content);
      continue;
    }

    tui.renderInfoMessage(`[${message.role}] ${content}`);
  }
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
        "Commands: /help, /new, /resume, /commit, /providers, /connect, /change-key, /disconnect, /provider, /model, /web, /web-provider, /web-logout, /permissions, /logout, /bye, /exit",
    };
  }

  if (command === "new") {
    return startNewSession(state);
  }

  if (command === "commit") {
    await runTask(commitWorkflowPrompt(state.projectRoot), tui, state);
    return {
      type: "continue",
      message: "Commit workflow finished.",
    };
  }

  if (command === "resume") {
    const args = trimmed.slice(command.length + 1).trim();
    if (!args) {
      const picked = await pickSession(tui, "Choose session to resume");
      if (picked === "cancel") {
        const lines = await historySummary();
        return {
          type: "continue",
          message: lines.map((line) => line.text).join("\n"),
          lines,
        };
      }

      return continueSession(picked, state);
    }

    return continueSession(args, state);
  }

  if (command === "providers") {
    const lines = await providersSummary(state);
    return {
      type: "continue",
      message: lines.map((line) => line.text).join("\n"),
      lines,
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

  if (command === "model") {
    const args = trimmed.slice(command.length + 1).trim();
    if (!args || args.toLowerCase() === "pick" || args.toLowerCase() === "list") {
      return setModel(tui, state);
    }

    return setModel(tui, state, args);
  }

  if (command === "permissions") {
    return {
      type: "continue",
      message: await permissionsSummary(),
    };
  }

  if (command === "mode" || command === "approval") {
    const args = trimmed.slice(command.length + 1).trim();
    return setApprovalMode(tui, state, args);
  }

  if (command === "connect") {
    const args = trimmed.slice(command.length + 1).trim();
    if (args) {
      const provider = normalizeProvider(args);
      if (!provider) {
        return { type: "continue", message: `Unknown provider: ${args}` };
      }
      return connectProvider(tui, state, provider);
    }

    return connectProvider(tui, state);
  }

  if (command === "change-key") {
    const args = trimmed.slice(command.length + 1).trim();
    if (!args) {
      return { type: "continue", message: "Usage: /change-key <provider>" };
    }
    const provider = normalizeProvider(args);
    if (!provider) {
      return { type: "continue", message: `Unknown provider: ${args}` };
    }
    return connectProvider(tui, state, provider);
  }

  if (command === "disconnect") {
    const args = trimmed.slice(command.length + 1).trim();
    if (!args) {
      return { type: "continue", message: "Usage: /disconnect <provider>" };
    }
    const provider = normalizeProvider(args);
    if (!provider) {
      return { type: "continue", message: `Unknown provider: ${args}` };
    }

    const statuses = await listProviderStatuses();
    const status = statuses.find((item) => item.provider === provider);
    if (!status?.saved) {
      return {
        type: "continue",
        message: status?.env
          ? `Provider ${provider} is coming from env. Remove the env var manually.`
          : `Provider ${provider} has no saved key.`,
      };
    }

    await removeProviderAuth(provider);
    clearProviderEnv(provider);
    const resolved = await resolveActiveProvider();
    updateSessionState(state, resolved);
    tui.setActiveModel(state.modelId);
    return {
      type: "continue",
      message: state.provider
        ? `Disconnected ${provider}. Active ${activeProviderSummary(state)}`
        : `Disconnected ${provider}. No active provider configured.`,
    };
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
    tui.setActiveModel(state.modelId);

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

async function runInteractive(tui: Tui, state: SessionState): Promise<void> {
  while (true) {
    const line = await tui.readInputLine();
    if (line.length === 0) continue;

    const slash = await handleSlashCommand(line, tui, state);
    if (slash.type === "exit") {
      tui.renderApprovalPrompt(null);
      break;
    }
    if (slash.type === "continue") {
      tui.renderApprovalPrompt(null);
      if (slash.restoreSessionId) {
        await replaySessionTranscript(tui, slash.restoreSessionId);
      }
      if (slash.lines && slash.lines.length > 0) {
        tui.renderInfoLines(slash.lines);
      } else if (slash.message.includes("\n")) {
        tui.renderInfoMessage(slash.message);
      } else {
        tui.renderApprovalPrompt({
          message: slash.message,
        });
      }
      continue;
    }

    if (line === "exit" || line === "quit") {
      tui.renderApprovalPrompt(null);
      break;
    }

    try {
      await runTask(line, tui, state);
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
  const cwd = process.cwd();
  const projectRoot = resolveProjectRoot(cwd);
  const state: SessionState = {
    sessionId,
    sessionTitle: null,
    projectRoot,
    approvalMode: "suggest",
    provider: null,
    modelId: "",
    authSource: null,
    webProvider: null,
    webAuthSource: null,
  };

  const tuiConfig = await loadTuiConfig(cwd);
  const keybinds = new KeybindManager(tuiConfig.keybinds);
  const promptOptions = [
    `${keybinds.print("input_submit")}=run`,
    `${keybinds.print("input_clear")}=clear`,
    `${keybinds.print("app_exit")}=quit`,
  ];
  const slashCommandOptions: SlashCommandItem[] = [
    { name: "/providers", description: "show provider connection status" },
    { name: "/new", description: "start a fresh session" },
    { name: "/resume", description: "pick and resume a saved session" },
    commitSlashCommandItem,
    { name: "/connect", description: "connect a model provider" },
    { name: "/change-key", description: "update a provider API key" },
    { name: "/disconnect", description: "remove a saved provider key" },
    { name: "/provider", description: "show the active model provider" },
    { name: "/model", description: "choose the active model" },
    { name: "/mode", description: "choose the approval mode" },
    { name: "/web", description: "connect a web search provider" },
    { name: "/web-provider", description: "show the active web search provider" },
    { name: "/web-logout", description: "remove the saved web provider key" },
    { name: "/permissions", description: "show saved permission rules" },
    { name: "/logout", description: "remove the saved model provider key" },
    { name: "/help", description: "show available slash commands" },
    { name: "/bye", description: "exit xeq" },
  ];

  const tui: Tui = new PiTui();
  await tui.start();
  tui.setSlashCommands(slashCommandOptions);

  const handleSigint = () => {
    tui.stop();
    process.exit(130);
  };
  process.once("SIGINT", handleSigint);

  try {
    const ready = await ensureProviderConnected(tui, state);
    if (!ready) return;
    tui.setActiveModel(state.modelId);
    tui.renderStartupBanner();
    const existing = await getSession(state.sessionId);
    if (!existing) {
      await createSession({
        id: state.sessionId,
        title: initialTask ? titleFromTask(initialTask) : null,
        cwd,
        project_root: state.projectRoot,
        provider: state.provider ?? "unknown",
        model: state.modelId || "unknown",
      });
      state.sessionTitle = initialTask ? titleFromTask(initialTask) : null;
    } else {
      state.sessionTitle = existing.title ?? null;
    }

    tui.renderApprovalPrompt(null);

    if (initialTask) {
      await runTask(initialTask, tui, state);
    }

    await runInteractive(tui, state);
  } finally {
    process.off("SIGINT", handleSigint);
    tui.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
