import { type ComposerSubmission, createPlainComposerSubmission } from "@archer/shared/composer";
import type { AgentStep, RunSummary } from "@archer/shared/runtime";
import { Box, render, Spacer, Text, useApp, useInput, useStdout } from "ink";
import type React from "react";
import { useSyncExternalStore } from "react";
import { col } from "./internal/theme.js";

export interface ApprovalPromptState {
  message: string;
  options?: string[];
  choices?: ApprovalDialogChoice[];
  selectedIndex?: number;
  details?: string;
  review?: {
    summary: string;
    changedFilesCount: number;
    files: Array<{
      filePath: string;
      diff: string;
      status?: string;
    }>;
  };
}

export type ApprovalDialogChoice = {
  value: string;
  label: string;
  description?: string;
};

export interface SlashCommandItem {
  name: string;
  description: string;
}

export type UiEvent =
  | { type: "startup-banner" }
  | { type: "active-model"; modelId: string }
  | { type: "user-message"; message: string }
  | { type: "assistant-message"; message: string }
  | { type: "info-message"; message: string }
  | { type: "event-message"; message: string }
  | { type: "info-lines"; lines: Array<{ text: string; color?: string }> }
  | { type: "step"; step: AgentStep }
  | { type: "assistant-delta"; delta: string }
  | { type: "finalize-assistant"; text?: string }
  | { type: "approval-prompt"; prompt: ApprovalPromptState | null }
  | { type: "summary"; summary: RunSummary }
  | { type: "slash-commands"; commands: SlashCommandItem[] };

export interface Tui {
  start(): Promise<void>;
  emit(event: UiEvent): void;
  setActiveModel(modelId: string): void;
  loadPersistentPromptHistory(entries: string[]): void;
  promptApproval(prompt: ApprovalPromptState): Promise<string>;
  readInput(): Promise<ComposerSubmission>;
  readInputLine(): Promise<string>;
  onCancelRunning(handler: (() => void) | null): void;
  stop(): void;
}

type LogEntry =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "info"; text: string }
  | { id: string; kind: "event"; text: string }
  | { id: string; kind: "step"; text: string }
  | { id: string; kind: "summary"; text: string };

type PromptKind = "input" | "approval";

type UiState = {
  activeModelLabel: string;
  promptKind: PromptKind | null;
  promptMessage: string;
  promptDetails: string;
  promptChoices: ApprovalDialogChoice[];
  promptText: string;
  promptSelectedIndex: number;
  commandSelectedIndex: number;
  logs: LogEntry[];
  slashCommands: SlashCommandItem[];
  pendingAssistantText: string;
};

type PendingInput = {
  resolve: (value: ComposerSubmission) => void;
};

type PendingLine = {
  resolve: (value: string) => void;
};

type PendingApproval = {
  resolve: (value: string) => void;
  prompt: ApprovalPromptState;
};

class UiStore {
  private state: UiState = {
    activeModelLabel: "model=unconfigured",
    promptKind: null,
    promptMessage: "",
    promptDetails: "",
    promptChoices: [],
    promptText: "",
    promptSelectedIndex: 0,
    commandSelectedIndex: -1,
    logs: [],
    slashCommands: [],
    pendingAssistantText: "",
  };
  private listeners = new Set<() => void>();
  private pendingInput: PendingInput | null = null;
  private pendingLine: PendingLine | null = null;
  private pendingApproval: PendingApproval | null = null;
  private cancelRunningHandler: (() => void) | null = null;
  private logSequence = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): UiState => this.state;

  private setState(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  startInput(promptKind: PromptKind, prompt: ApprovalPromptState | null = null): Promise<string> {
    return new Promise((resolve) => {
      if (promptKind === "approval") {
        this.pendingApproval = { resolve, prompt: prompt ?? { message: "" } };
        this.setState({
          promptKind,
          promptMessage: prompt?.message ?? "",
          promptDetails: prompt?.details ?? "",
          promptChoices: prompt?.choices ?? [],
          promptText: "",
          promptSelectedIndex: prompt?.selectedIndex ?? 0,
        });
        return;
      }

      this.pendingInput = { resolve: (submission) => resolve(submission.text) };
      this.setState({
        promptKind,
        promptMessage: prompt?.message ?? "",
        promptDetails: prompt?.details ?? "",
        promptChoices: [],
        promptText: "",
        promptSelectedIndex: 0,
      });
    });
  }

  appendPromptText(text: string): void {
    if (this.state.promptKind == null) {
      return;
    }
    this.setState({ promptText: `${this.state.promptText}${text}`, commandSelectedIndex: -1 });
  }

  backspacePromptText(): void {
    if (this.state.promptKind == null) {
      return;
    }
    this.setState({ promptText: this.state.promptText.slice(0, -1), commandSelectedIndex: -1 });
  }

  setPromptText(text: string): void {
    this.setState({ promptText: text, commandSelectedIndex: -1 });
  }

  moveCommandSelection(delta: number, total: number): void {
    if (total === 0) return;
    const current = this.state.commandSelectedIndex;
    const next = current === -1 ? (delta > 0 ? 0 : total - 1) : (current + delta + total) % total;
    this.setState({ commandSelectedIndex: next });
  }

  resetCommandSelection(): void {
    if (this.state.commandSelectedIndex !== -1) {
      this.setState({ commandSelectedIndex: -1 });
    }
  }

  submitPromptText(): void {
    if (
      this.state.promptKind === "approval" &&
      this.state.promptChoices.length > 0 &&
      !this.state.promptText.trim()
    ) {
      const selected =
        this.state.promptChoices[this.state.promptSelectedIndex] ?? this.state.promptChoices[0];
      if (selected) {
        this.submitText(selected.value);
        return;
      }
    }
    this.submitText(this.state.promptText);
  }

  moveApprovalSelection(delta: number): void {
    if (this.state.promptKind !== "approval" || this.state.promptChoices.length === 0) {
      return;
    }

    const length = this.state.promptChoices.length;
    const nextIndex = (this.state.promptSelectedIndex + delta + length) % length;
    this.setState({
      promptSelectedIndex: nextIndex,
      promptText: this.state.promptChoices[nextIndex]?.value ?? "",
    });
  }

  submitText(text: string): void {
    if (this.pendingInput) {
      const resolve = this.pendingInput.resolve;
      this.pendingInput = null;
      this.setState({ promptKind: null, promptText: "" });
      resolve(createPlainComposerSubmission(text));
      return;
    }

    if (this.pendingLine) {
      const resolve = this.pendingLine.resolve;
      this.pendingLine = null;
      this.setState({ promptKind: null, promptText: "" });
      resolve(text);
      return;
    }

    if (this.pendingApproval) {
      const choice = this.resolveApprovalSelection(text);
      if (!choice) {
        return;
      }
      const resolve = this.pendingApproval.resolve;
      this.pendingApproval = null;
      this.setState({ promptKind: null, promptText: "" });
      resolve(choice);
    }
  }

  private resolveApprovalSelection(input: string): string | null {
    const text = input.trim();
    if (!text) return null;

    const prompt = this.pendingApproval?.prompt;
    if (!prompt) return null;
    if (prompt.choices && prompt.choices.length > 0) {
      const index = Number.parseInt(text, 10);
      if (!Number.isNaN(index) && index >= 1 && index <= prompt.choices.length) {
        return prompt.choices[index - 1]?.value ?? "reject";
      }
      const match = prompt.choices.find((choice) => choice.value === text);
      return match?.value ?? null;
    }

    if (text === "y" || text === "yes" || text === "approve") {
      return "approve";
    }
    if (text === "n" || text === "no" || text === "reject") {
      return "reject";
    }
    return null;
  }

  startLineInput(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.pendingLine = { resolve };
      this.setState({
        promptKind: "input",
        promptMessage: prompt,
        promptDetails: "",
        promptChoices: [],
        promptText: "",
        promptSelectedIndex: 0,
      });
    });
  }

  setPrompt(prompt: ApprovalPromptState | null): void {
    if (!prompt) {
      this.pendingApproval = null;
      this.setState({
        promptKind: null,
        promptMessage: "",
        promptDetails: "",
        promptChoices: [],
        promptText: "",
        promptSelectedIndex: 0,
      });
      return;
    }

    this.setState({
      promptKind: this.state.promptKind ?? "approval",
      promptMessage: prompt.message,
      promptDetails: prompt.details ?? "",
      promptChoices: prompt.choices ?? [],
      promptSelectedIndex: prompt.selectedIndex ?? 0,
    });
  }

  appendLog(entry: LogEntry): void {
    this.setState({ logs: [...this.state.logs, entry] });
  }

  private pushLog(kind: LogEntry["kind"], text: string): void {
    this.appendLog({
      id: `log_${this.logSequence++}`,
      kind,
      text,
    } as LogEntry);
  }

  setActiveModel(modelId: string): void {
    this.emit({ type: "active-model", modelId });
  }

  setSlashCommands(commands: SlashCommandItem[]): void {
    this.emit({ type: "slash-commands", commands });
  }

  setCancelRunningHandler(handler: (() => void) | null): void {
    this.cancelRunningHandler = handler;
  }

  cancelRunning(): void {
    this.cancelRunningHandler?.();
  }

  setAssistantDelta(delta: string): void {
    this.setState({ pendingAssistantText: this.state.pendingAssistantText + delta });
  }

  finalizeAssistantText(text?: string): void {
    const value = text ?? this.state.pendingAssistantText;
    if (value.trim()) {
      this.pushLog("assistant", value);
    }
    this.setState({ pendingAssistantText: "" });
  }

  emit(event: UiEvent): void {
    switch (event.type) {
      case "startup-banner":
        break;
      case "active-model":
        this.setState({
          activeModelLabel: event.modelId ? `model=${event.modelId}` : "model=unconfigured",
        });
        break;
      case "user-message":
        this.pushLog("user", event.message);
        break;
      case "assistant-message":
        this.pushLog("assistant", event.message);
        break;
      case "info-message":
        this.pushLog("info", event.message);
        break;
      case "event-message":
        this.pushLog("event", event.message);
        break;
      case "info-lines":
        for (const line of event.lines) {
          this.pushLog("info", line.text);
        }
        break;
      case "step": {
        const step = event.step;
        const thought = step.thought ? ` ${step.thought}` : "";
        const observation = step.observation ? ` -> ${step.observation}` : "";
        this.pushLog("step", `[${step.step}] ${step.action}${thought}${observation}`);
        break;
      }
      case "assistant-delta":
        this.setAssistantDelta(event.delta);
        break;
      case "finalize-assistant":
        this.finalizeAssistantText(event.text);
        break;
      case "approval-prompt":
        this.setPrompt(event.prompt);
        break;
      case "summary":
        this.pushLog(
          "summary",
          `success=${event.summary.success} steps=${event.summary.steps} duration_ms=${event.summary.durationMs} prompt_tokens=${event.summary.promptTokens} completion_tokens=${event.summary.completionTokens} est_cost_usd=${event.summary.estimatedCostUsd}`,
        );
        break;
      case "slash-commands":
        this.setState({ slashCommands: event.commands });
        break;
    }
  }
}

function filterSlashCommands(state: UiState): SlashCommandItem[] {
  const raw = state.promptText.trim();
  if (!raw.startsWith("/")) {
    return state.slashCommands;
  }
  const query = raw.slice(1).toLowerCase();
  if (!query) {
    return state.slashCommands;
  }
  return state.slashCommands.filter((command) => {
    return (
      command.name.toLowerCase().includes(query) ||
      command.description.toLowerCase().includes(query)
    );
  });
}

function Divider({ width }: { width: number }): React.ReactNode {
  const len = Math.max(1, width - 4);
  return (
    <Box paddingX={2}>
      <Text color={col.border}>{"─".repeat(len)}</Text>
    </Box>
  );
}

function Header({ state }: { state: UiState }): React.ReactNode {
  const isStreaming = state.pendingAssistantText.length > 0;
  const dot = isStreaming || state.promptKind ? "●" : "○";
  const statusLabel = isStreaming
    ? "running"
    : state.promptKind === "approval"
      ? "approval"
      : state.promptKind === "input"
        ? "input"
        : "ready";
  const statusColor = isStreaming
    ? col.summary
    : state.promptKind === "approval"
      ? col.event
      : state.promptKind === "input"
        ? col.accent
        : col.user;

  return (
    <Box paddingX={2} paddingTop={1} paddingBottom={1} justifyContent="space-between">
      <Box gap={2}>
        <Text color={col.accent} bold>
          ◈ ARCHER
        </Text>
      </Box>
      <Box gap={2}>
        <Text color={col.step}>{state.activeModelLabel}</Text>
        <Text color={statusColor} bold>
          {dot} {statusLabel}
        </Text>
      </Box>
    </Box>
  );
}

function LogItem({ entry, index }: { entry: LogEntry; index: number }): React.ReactNode {
  if (entry.kind === "user") {
    return (
      <Box flexDirection="column" marginTop={index === 0 ? 0 : 1}>
        <Box gap={1}>
          <Text color={col.user} bold>
            ›
          </Text>
          <Text color={col.user} bold>
            you
          </Text>
        </Box>
        <Box paddingLeft={2}>
          <Text color={col.text} wrap="wrap">
            {entry.text}
          </Text>
        </Box>
      </Box>
    );
  }

  if (entry.kind === "assistant") {
    const isPending = entry.id === "pending";
    return (
      <Box flexDirection="column" marginTop={index === 0 ? 0 : 1}>
        <Box gap={1}>
          <Text color={col.accent} bold>
            ✦
          </Text>
          <Text color={col.accent} bold>
            archer
          </Text>
        </Box>
        <Box paddingLeft={2}>
          <Text color={col.text} wrap="wrap">
            {entry.text}
            {isPending ? "▌" : ""}
          </Text>
        </Box>
      </Box>
    );
  }

  if (entry.kind === "step") {
    return (
      <Box gap={2}>
        <Text color={col.step}>⟩</Text>
        <Text color={col.step} wrap="wrap">
          {entry.text}
        </Text>
      </Box>
    );
  }

  if (entry.kind === "summary") {
    return (
      <Box flexDirection="column" marginTop={index === 0 ? 0 : 1}>
        <Box gap={1}>
          <Text color={col.summary} bold>
            ✓
          </Text>
          <Text color={col.summary} bold>
            done
          </Text>
        </Box>
        <Box paddingLeft={2}>
          <Text color={col.muted} wrap="wrap">
            {entry.text}
          </Text>
        </Box>
      </Box>
    );
  }

  if (entry.kind === "event") {
    return (
      <Box gap={2}>
        <Text color={col.event}>◈</Text>
        <Text color={col.muted} wrap="wrap">
          {entry.text}
        </Text>
      </Box>
    );
  }

  // info
  return (
    <Box gap={2}>
      <Text color={col.dimmed}>·</Text>
      <Text color={col.muted} wrap="wrap">
        {entry.text}
      </Text>
    </Box>
  );
}

function WelcomeBanner({ state }: { state: UiState }): React.ReactNode {
  const model = state.activeModelLabel.replace("model=", "") || "unconfigured";
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const cwd = process.cwd().replace(home, "~");

  return (
    <Box flexDirection="column" paddingX={2} paddingTop={1} paddingBottom={0}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={col.border}
        paddingX={2}
        paddingY={1}
      >
        <Box gap={2}>
          <Text color={col.accent} bold>
            {"❯_"}
          </Text>
          <Text color={col.text} bold>
            ARCHER
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={col.muted}>{"model     "}</Text>
            <Text color={col.text}>{model}</Text>
            <Text color={col.dimmed}>{"  /model to change"}</Text>
          </Box>
          <Box>
            <Text color={col.muted}>{"directory "}</Text>
            <Text color={col.text}>{cwd}</Text>
          </Box>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={col.muted}>{"Tip: Run "}</Text>
        <Text color={col.accent}>{"/init"}</Text>
        <Text color={col.muted}>{" to create ARCHER.md with project context"}</Text>
      </Box>
    </Box>
  );
}

function ActivityLog({
  logs,
  pendingText,
}: {
  logs: LogEntry[];
  pendingText: string;
}): React.ReactNode {
  const transcript: LogEntry[] = [
    ...logs.slice(-16),
    ...(pendingText ? [{ id: "pending", kind: "assistant" as const, text: pendingText }] : []),
  ];

  return (
    <Box flexDirection="column" paddingX={2} paddingTop={1} paddingBottom={1}>
      {transcript.map((entry, i) => (
        <LogItem key={entry.id ?? String(i)} entry={entry} index={i} />
      ))}
    </Box>
  );
}

function Composer({
  state,
  commandMatches,
}: {
  state: UiState;
  commandMatches: SlashCommandItem[];
}): React.ReactNode {
  const isApproval = state.promptKind === "approval";
  const isInput = state.promptKind === "input";
  const isCommandMode = isInput && state.promptText.trim().startsWith("/");
  const borderColor = isApproval ? col.event : isInput ? col.accent : col.border;

  const hasChoices = isApproval && state.promptChoices.length > 0;
  const hasCommandMatches = isCommandMode && commandMatches.length > 0;
  const hasTopContent = !!state.promptMessage || !!state.promptDetails || hasChoices;

  const footerHints = hasChoices
    ? "↵ accept  ↑↓ move  ^C quit"
    : isCommandMode && commandMatches.length > 0
      ? "↵/tab select  ↑↓ move  ^C quit"
      : isInput
        ? "↵ submit  / commands  ^C quit"
        : "^C quit";

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
        {state.promptMessage ? (
          <Text color={col.text} wrap="wrap">
            {state.promptMessage}
          </Text>
        ) : null}
        {state.promptDetails ? <Text color={col.muted}>{state.promptDetails}</Text> : null}

        {hasChoices ? (
          <Box flexDirection="column" marginTop={hasTopContent ? 1 : 0}>
            {state.promptChoices.map((choice, index) => {
              const selected = index === state.promptSelectedIndex;
              return (
                <Box key={choice.value} gap={1}>
                  <Text color={selected ? col.accent : col.dimmed} bold>
                    {selected ? "▶" : " "}
                  </Text>
                  <Text color={selected ? col.text : col.muted}>
                    {index + 1}. {choice.label}
                  </Text>
                  {choice.description ? (
                    <Text color={col.dimmed}> {choice.description}</Text>
                  ) : null}
                </Box>
              );
            })}
          </Box>
        ) : null}

        {/* Input line — always first, commands appear below */}
        {state.promptKind ? (
          <Box marginTop={hasTopContent ? 1 : 0}>
            <Text color={col.accent} bold>
              {"❯ "}
            </Text>
            <Text color={col.text}>{state.promptText}</Text>
            <Text color={col.accent}>▌</Text>
          </Box>
        ) : (
          <Box>
            <Text color={col.dimmed}>{"❯ "}</Text>
            <Text color={col.dimmed}>type a message or / for commands</Text>
          </Box>
        )}
      </Box>

      {/* Hints — always right-aligned directly below the box */}
      <Box justifyContent="flex-end" paddingX={2}>
        <Text color={col.dimmed}>{footerHints}</Text>
      </Box>

      {/* Command palette — scrollable window of 6 */}
      {hasCommandMatches ? (
        <Box flexDirection="column" paddingX={2}>
          {(() => {
            const WINDOW = 6;
            const sel = state.commandSelectedIndex;
            const total = commandMatches.length;
            const offset =
              sel < 0 ? 0 : Math.max(0, Math.min(sel - Math.floor(WINDOW / 2), total - WINDOW));
            const visible = commandMatches.slice(offset, offset + WINDOW);
            const moreBelow = offset + WINDOW < total;
            const moreAbove = offset > 0;
            return (
              <>
                {moreAbove ? <Text color={col.dimmed}> ↑ {offset} more</Text> : null}
                {visible.map((cmd, i) => {
                  const absIdx = offset + i;
                  const selected = absIdx === sel;
                  return (
                    <Box key={cmd.name} gap={3}>
                      <Text color={selected ? col.accent : col.text} bold={selected}>
                        {cmd.name}
                      </Text>
                      <Text color={selected ? col.text : col.dimmed}>{cmd.description}</Text>
                    </Box>
                  );
                })}
                {moreBelow ? (
                  <Text color={col.dimmed}> ↓ {total - offset - WINDOW} more</Text>
                ) : null}
              </>
            );
          })()}
        </Box>
      ) : null}
    </Box>
  );
}

function App({ store }: { store: UiStore }): React.ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;
  const termHeight = stdout?.rows ?? 24;

  const commandMatches = filterSlashCommands(state);
  const isCommandMode = state.promptKind === "input" && state.promptText.trim().startsWith("/");

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      store.cancelRunning();
      exit();
      return;
    }

    if (state.promptKind == null) {
      return;
    }

    if (isCommandMode && commandMatches.length > 0) {
      if (key.downArrow) {
        store.moveCommandSelection(1, commandMatches.length);
        return;
      }
      if (key.upArrow) {
        store.moveCommandSelection(-1, commandMatches.length);
        return;
      }
      if (key.tab) {
        const idx = state.commandSelectedIndex >= 0 ? state.commandSelectedIndex : 0;
        const cmd = commandMatches[idx];
        if (cmd) store.setPromptText(cmd.name);
        return;
      }
      if (key.return && state.commandSelectedIndex >= 0) {
        const cmd = commandMatches[state.commandSelectedIndex];
        if (cmd) {
          store.setPromptText(cmd.name);
          store.submitPromptText();
        }
        return;
      }
    }

    if (key.return) {
      store.submitPromptText();
      return;
    }

    if (state.promptKind === "approval" && state.promptChoices.length > 0) {
      if (key.upArrow) {
        store.moveApprovalSelection(-1);
        return;
      }
      if (key.downArrow) {
        store.moveApprovalSelection(1);
        return;
      }
    }

    if (key.backspace || key.delete) {
      store.backspacePromptText();
      return;
    }

    if (input) {
      store.appendPromptText(input);
    }
  });

  const showBanner = state.logs.length === 0 && !state.pendingAssistantText;
  // Ink only expands Spacer/flexGrow when the parent has an explicit height.
  // On startup, let content flow naturally so the banner sits above the composer.
  const pinComposerToBottom = !showBanner;

  return (
    <Box flexDirection="column" {...(pinComposerToBottom ? { height: termHeight } : {})}>
      <Header state={state} />
      <Box flexDirection="column" {...(pinComposerToBottom ? { flexGrow: 1 } : {})}>
        {showBanner ? (
          <WelcomeBanner state={state} />
        ) : (
          <ActivityLog logs={state.logs} pendingText={state.pendingAssistantText} />
        )}
        {pinComposerToBottom ? <Spacer /> : null}
        <Divider width={termWidth} />
        <Composer state={state} commandMatches={commandMatches} />
      </Box>
    </Box>
  );
}

export class ArcherTui implements Tui {
  private readonly store = new UiStore();
  private renderer: ReturnType<typeof render> | null = null;

  async start(): Promise<void> {
    if (this.renderer) return;
    this.renderer = render(<App store={this.store} />);
  }

  emit(event: UiEvent): void {
    this.store.emit(event);
  }

  setActiveModel(modelId: string): void {
    this.emit({ type: "active-model", modelId });
  }

  loadPersistentPromptHistory(_entries: string[]): void {}

  async promptApproval(prompt: ApprovalPromptState): Promise<string> {
    this.store.setPrompt(prompt);
    const value = await this.store.startInput("approval", prompt);
    return value || "reject";
  }

  async readInput(): Promise<ComposerSubmission> {
    const text = await this.store.startInput("input");
    return createPlainComposerSubmission(text);
  }

  async readInputLine(): Promise<string> {
    const text = await this.store.startInput("input");
    return text.trim();
  }

  onCancelRunning(handler: (() => void) | null): void {
    this.store.setCancelRunningHandler(handler);
  }

  stop(): void {
    this.renderer?.unmount();
    this.renderer = null;
  }
}
