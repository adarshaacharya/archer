import { createPlainComposerSubmission, type ComposerSubmission } from "@archer/shared/composer";
import type { AgentStep, RunSummary } from "@archer/shared/runtime";
import { render, Box, Text, useInput, useApp } from "ink";
import React, { useSyncExternalStore } from "react";

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
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "info"; text: string }
  | { kind: "event"; text: string }
  | { kind: "step"; text: string }
  | { kind: "summary"; text: string };

type PromptKind = "input" | "approval";

type UiState = {
  activeModelLabel: string;
  promptKind: PromptKind | null;
  promptMessage: string;
  promptDetails: string;
  promptChoices: ApprovalDialogChoice[];
  promptText: string;
  promptSelectedIndex: number;
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
    logs: [],
    slashCommands: [],
    pendingAssistantText: "",
  };
  private listeners = new Set<() => void>();
  private pendingInput: PendingInput | null = null;
  private pendingLine: PendingLine | null = null;
  private pendingApproval: PendingApproval | null = null;
  private cancelRunningHandler: (() => void) | null = null;

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
    this.setState({ promptText: `${this.state.promptText}${text}` });
  }

  backspacePromptText(): void {
    if (this.state.promptKind == null) {
      return;
    }
    this.setState({ promptText: this.state.promptText.slice(0, -1) });
  }

  submitPromptText(): void {
    if (
      this.state.promptKind === "approval" &&
      this.state.promptChoices.length > 0 &&
      !this.state.promptText.trim()
    ) {
      const selected = this.state.promptChoices[this.state.promptSelectedIndex] ?? this.state.promptChoices[0];
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
      this.appendLog({ kind: "assistant", text: value });
    }
    this.setState({ pendingAssistantText: "" });
  }

  emit(event: UiEvent): void {
    switch (event.type) {
      case "startup-banner":
        this.appendLog({ kind: "info", text: "Archer ready" });
        break;
      case "active-model":
        this.setState({
          activeModelLabel: event.modelId ? `model=${event.modelId}` : "model=unconfigured",
        });
        break;
      case "user-message":
        this.appendLog({ kind: "user", text: event.message });
        break;
      case "assistant-message":
        this.appendLog({ kind: "assistant", text: event.message });
        break;
      case "info-message":
        this.appendLog({ kind: "info", text: event.message });
        break;
      case "event-message":
        this.appendLog({ kind: "event", text: event.message });
        break;
      case "info-lines":
        for (const line of event.lines) {
          this.appendLog({ kind: "info", text: line.text });
        }
        break;
      case "step": {
        const step = event.step;
        const thought = step.thought ? ` ${step.thought}` : "";
        const observation = step.observation ? ` -> ${step.observation}` : "";
        this.appendLog({
          kind: "step",
          text: `[${step.step}] ${step.action}${thought}${observation}`,
        });
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
        this.appendLog({
          kind: "summary",
          text: `success=${event.summary.success} steps=${event.summary.steps} duration_ms=${event.summary.durationMs} prompt_tokens=${event.summary.promptTokens} completion_tokens=${event.summary.completionTokens} est_cost_usd=${event.summary.estimatedCostUsd}`,
        });
        break;
      case "slash-commands":
        this.setState({ slashCommands: event.commands });
        break;
    }
  }
}

function renderPromptSuffix(state: UiState): string {
  if (state.promptKind === "approval" && state.promptChoices.length > 0) {
    return "  " + state.promptChoices.map((choice, index) => `${index + 1}:${choice.label}`).join("  ");
  }
  if (state.promptKind === "input") {
    return "  enter to submit";
  }
  return "";
}

function renderApprovalChoices(state: UiState): string {
  if (state.promptKind !== "approval" || state.promptChoices.length === 0) {
    return "";
  }

  return state.promptChoices
    .map((choice, index) => `${index === state.promptSelectedIndex ? ">" : " "} ${index + 1}. ${choice.label}`)
    .join("  ");
}

function renderSlashCommandStrip(commands: SlashCommandItem[]): string {
  return commands.slice(0, 5).map((command) => `/${command.name}`).join("  ");
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

function renderFooter(state: UiState): string {
  if (state.promptKind === "approval" && state.promptChoices.length > 0) {
    return "enter accept  •  ↑↓ move  •  ctrl+c quit";
  }
  if (state.promptKind === "input" && state.promptText.trim().startsWith("/")) {
    return "enter submit  •  tab to stay in command mode  •  ctrl+c quit";
  }
  if (state.promptKind === "input") {
    return "enter submit  •  ctrl+c quit";
  }
  return "ctrl+c quit";
}

function formatLogEntry(entry: LogEntry): string {
  switch (entry.kind) {
    case "user":
      return `you> ${entry.text}`;
    case "assistant":
      return `ai> ${entry.text}`;
    case "info":
      return `info> ${entry.text}`;
    case "event":
      return `event> ${entry.text}`;
    case "step":
      return `step> ${entry.text}`;
    case "summary":
      return `done> ${entry.text}`;
  }
}

function formatStatusLine(state: UiState): string {
  const promptState =
    state.promptKind === "approval"
      ? "approval"
      : state.promptKind === "input"
        ? "input"
        : "idle";
  return `${state.activeModelLabel}  ${promptState}`;
}

function App({ store }: { store: UiStore }): React.ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      store.cancelRunning();
      exit();
      return;
    }

    if (state.promptKind == null) {
      return;
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

  const transcript = [...state.logs.slice(-22), ...(state.pendingAssistantText ? [{ kind: "assistant", text: state.pendingAssistantText } as const] : [])];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color="green" bold>
          Archer
        </Text>
        <Text dimColor>{formatStatusLine(state)}</Text>
      </Box>
      <Text dimColor>
        {state.slashCommands.length > 0 ? renderSlashCommandStrip(state.slashCommands) : "Ctrl+C"}
      </Text>
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {transcript.map((entry, index) => (
          <Text
            key={`${index}:${entry.kind}:${entry.text}`}
            color={
              entry.kind === "assistant"
                ? "cyan"
                : entry.kind === "user"
                  ? "green"
                  : entry.kind === "summary"
                    ? "yellow"
                    : entry.kind === "event"
                      ? "magenta"
                      : "white"
            }
            wrap="truncate-end"
          >
            {formatLogEntry(entry)}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {state.promptKind ? (
          <>
            <Text color="cyan">
              {state.promptMessage}
              {renderPromptSuffix(state)}
            </Text>
            {state.promptDetails ? <Text dimColor>{state.promptDetails}</Text> : null}
            {state.promptKind === "approval" && state.promptChoices.length > 0 ? (
              <Text color="yellow">{renderApprovalChoices(state)}</Text>
            ) : null}
            {state.promptKind === "input" && state.promptText.trim().startsWith("/") ? (
              <Text dimColor>{renderSlashCommandStrip(filterSlashCommands(state))}</Text>
            ) : null}
            <Text>{`> ${state.promptText}`}</Text>
            <Text dimColor>{renderFooter(state)}</Text>
          </>
        ) : (
          <Text dimColor>{renderFooter(state)}</Text>
        )}
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
