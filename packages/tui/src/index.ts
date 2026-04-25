import { Container, Key, ProcessTerminal, TUI, Text, matchesKey } from "@mariozechner/pi-tui";
import type { AgentStep, RunSummary } from "@xeq/shared";
import { ApprovalDialog, type ApprovalDialogChoice } from "./approval-dialog.js";
import { ComposerPanel } from "./composer-panel.js";
import { defaultTuiLayout } from "./layout.js";
import { PatchReviewDialog, type PatchReviewState } from "./review-dialog.js";
import { buildWelcomePanel } from "./welcome-panel.js";

export interface ApprovalPromptState {
  message: string;
  options?: string[];
  choices?: ApprovalDialogChoice[];
  details?: string;
  review?: PatchReviewState;
}

export interface SlashCommandItem {
  name: string;
  description: string;
}

export interface Tui {
  start(): Promise<void>;
  renderUserMessage(message: string): void;
  renderStep(step: AgentStep): void;
  renderAssistantDelta(delta: string): void;
  finalizeAssistantStream(text?: string): void;
  renderApprovalPrompt(prompt: ApprovalPromptState | null): void;
  promptApproval(prompt: ApprovalPromptState): Promise<string>;
  renderSummary(summary: RunSummary): void;
  setSlashCommands(commands: SlashCommandItem[]): void;
  readInputLine(): Promise<string>;
  onCancelRunning(handler: (() => void) | null): void;
  stop(): void;
}

type TuiViewState = {
  header: string;
  status: string;
  transcript: string;
  prompt: string;
  hints: string;
};

const XEQ_HEADER = "\x1b[1m\x1b[36mXEQ\x1b[0m  \x1b[2mcoding agent\x1b[0m";

const STEP_ICONS: Record<string, string> = {
  write: "◆",
  patch: "◆",
  apply: "◆",
  create: "◆",
  edit: "◆",
  run: "❯",
  exec: "❯",
  command: "❯",
  bash: "❯",
  shell: "❯",
  web: "◎",
  fetch: "◎",
  search: "◎",
};

function getStepIcon(action: string): string {
  const a = action.toLowerCase();
  for (const [key, icon] of Object.entries(STEP_ICONS)) {
    if (a.includes(key)) return icon;
  }
  return "⏺";
}

export class PiTui implements Tui {
  private terminal: ProcessTerminal | null = null;
  private tui: TUI | null = null;
  private rootContainer: Container | null = null;
  private headerText: Text | null = null;
  private statusText: Text | null = null;
  private transcriptText: Text | null = null;
  private composerPanel: ComposerPanel | null = null;
  private input: ComposerPanel["input"] | null = null;
  private approvalOverlay: { hide: () => void } | null = null;
  private removeInputListener: (() => void) | null = null;
  private cancelRunningHandler: (() => void) | null = null;
  private pendingReadResolve: ((line: string) => void) | null = null;
  private pendingApprovalResolve: ((choice: string) => void) | null = null;
  private slashCommands: SlashCommandItem[] = [];
  private fixedPromptOptions: string[] | null = null;
  private currentInput = "";
  private steps: string[] = [];
  private assistantStreamText = "";
  private viewState: TuiViewState = {
    header: "",
    status: "",
    transcript: "",
    prompt: ">",
    hints: "",
  };

  async start(): Promise<void> {
    this.terminal = new ProcessTerminal();
    this.tui = new TUI(this.terminal);

    this.rootContainer = new Container();
    this.headerText = new Text(XEQ_HEADER, 0, 0);
    this.transcriptText = new Text(this.viewState.transcript, 0, 0);

    this.composerPanel = new ComposerPanel();
    this.input = this.composerPanel.input;

    this.rootContainer.addChild(this.headerText);
    this.rootContainer.addChild(new Text("", 0, 0));
    this.rootContainer.addChild(this.transcriptText);
    this.rootContainer.addChild(new Text("", 0, 0));
    this.rootContainer.addChild(this.composerPanel);

    this.tui.addChild(this.rootContainer);
    this.tui.setFocus(this.composerPanel);

    this.input.onSubmit = (value: string) => {
      const submit = value.trim();
      this.input?.setValue("");
      this.currentInput = "";
      if (this.pendingReadResolve) {
        const resolve = this.pendingReadResolve;
        this.pendingReadResolve = null;
        resolve(submit);
      }
      this.requestRender();
    };

    this.tui.start();

    this.steps.push(buildWelcomePanel(process.stdout.columns || 80));
    this.viewState.transcript = this.getTranscriptText();

    this.removeInputListener = this.tui.addInputListener((data) => {
      if (matchesKey(data, Key.escape)) {
        if (this.approvalOverlay) {
          return undefined;
        }
        this.cancelRunningHandler?.();
        return { consume: true };
      }

      queueMicrotask(() => {
        const nextValue = this.input?.getValue() ?? "";
        if (nextValue !== this.currentInput) {
          this.currentInput = nextValue;
          this.requestRender();
        }
      });

      return undefined;
    });
  }

  renderUserMessage(message: string): void {
    const text = message.trim();
    if (!text) return;

    this.steps.push(`\x1b[1m▶ ${text}\x1b[0m`);
    if (this.steps.length > defaultTuiLayout.maxStepsVisible) this.steps.shift();
    this.viewState.transcript = this.getTranscriptText();
    this.requestRender();
  }

  renderStep(step: AgentStep): void {
    const icon = getStepIcon(step.action);
    const lines: string[] = [];

    lines.push(`\x1b[36m${icon} \x1b[1m${step.action}\x1b[0m\x1b[2m  ·  ${step.step}\x1b[0m`);

    if (step.thought) {
      const thought = step.thought.length > 150 ? `${step.thought.slice(0, 150)}…` : step.thought;
      lines.push(`\x1b[2m  ${thought}\x1b[0m`);
    }

    if (step.observation) {
      const obs = step.observation.trim();
      if (obs) {
        const obsLines = obs.split("\n");
        const maxLines = 8;
        const visible = obsLines.slice(0, maxLines).map((l) => `  ${l}`);
        if (obsLines.length > maxLines) {
          visible.push(`\x1b[2m  … ${obsLines.length - maxLines} more lines\x1b[0m`);
        }
        lines.push(...visible);
      }
    }

    this.steps.push(lines.join("\n"));
    if (this.steps.length > defaultTuiLayout.maxStepsVisible) this.steps.shift();
    this.viewState.transcript = this.getTranscriptText();
    this.requestRender();
  }

  renderAssistantDelta(delta: string): void {
    if (!delta) return;
    this.assistantStreamText += delta;
    this.requestRender();
  }

  finalizeAssistantStream(text?: string): void {
    const finalText = (text ?? this.assistantStreamText).trim();
    if (finalText.length > 0) {
      this.steps.push(finalText);
    }
    this.assistantStreamText = "";
    this.requestRender();
  }

  renderApprovalPrompt(prompt: ApprovalPromptState | null): void {
    if (!prompt) {
      this.hideApprovalOverlay();
      this.viewState.prompt = "";
      this.fixedPromptOptions = null;
      this.viewState.hints = this.getPromptHints();
      this.requestRender();
      return;
    }

    this.hideApprovalOverlay();
    this.viewState.prompt = prompt.message;
    this.fixedPromptOptions = prompt.options ?? null;
    this.viewState.hints = this.getPromptHints();
    this.requestRender();
  }

  promptApproval(prompt: ApprovalPromptState): Promise<string> {
    const tui = this.tui;
    if (!tui) return Promise.resolve("reject");

    this.hideApprovalOverlay();
    this.viewState.prompt = "";
    this.fixedPromptOptions = null;
    this.viewState.hints = "";

    return new Promise<string>((resolve) => {
      this.pendingApprovalResolve = resolve;
      const dialog = prompt.review
        ? new PatchReviewDialog(prompt.message, prompt.details, prompt.review, prompt.choices ?? [])
        : new ApprovalDialog(
            prompt.details ? `${prompt.message}\n\n${prompt.details}` : prompt.message,
            prompt.choices ?? [],
          );

      dialog.onSelect = (value) => {
        const pending = this.pendingApprovalResolve;
        this.pendingApprovalResolve = null;
        this.hideApprovalOverlay();
        pending?.(value);
        this.requestRender();
      };
      dialog.onCancel = () => {
        const pending = this.pendingApprovalResolve;
        this.pendingApprovalResolve = null;
        this.hideApprovalOverlay();
        pending?.(prompt.choices?.find((choice) => choice.value === "reject")?.value ?? "reject");
        this.requestRender();
      };

      this.approvalOverlay = tui.showOverlay(dialog, {
        anchor: "bottom-center",
        width: "84%",
        minWidth: 54,
        maxHeight: 18,
        margin: { bottom: 1 },
      });
      this.requestRender();
    });
  }

  renderSummary(summary: RunSummary): void {
    const status = summary.success ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    const duration = `${(summary.durationMs / 1000).toFixed(1)}s`;
    const stepCount = `${summary.steps} step${summary.steps !== 1 ? "s" : ""}`;
    this.steps.push(
      `${status} \x1b[32mCompleted\x1b[0m  \x1b[2m${stepCount} · ${duration}\x1b[0m`,
    );
    this.viewState.transcript = this.getTranscriptText();
    this.requestRender();
  }

  setSlashCommands(commands: SlashCommandItem[]): void {
    this.slashCommands = commands;
    this.viewState.hints = this.getPromptHints();
    this.requestRender();
  }

  stop(): void {
    if (this.removeInputListener) this.removeInputListener();
    if (this.tui) this.tui.stop();
    this.tui = null;
    this.terminal = null;
    this.rootContainer = null;
    this.headerText = null;
    this.statusText = null;
    this.transcriptText = null;
    this.composerPanel = null;
    this.input = null;
    this.pendingReadResolve = null;
    this.approvalOverlay = null;
    this.pendingApprovalResolve = null;
    this.removeInputListener = null;
    this.cancelRunningHandler = null;
  }

  readInputLine(): Promise<string> {
    if (!this.tui || !this.input) return Promise.resolve("");
    if (this.composerPanel) {
      this.tui.setFocus(this.composerPanel);
    } else {
      this.tui.setFocus(this.input);
    }
    return new Promise<string>((resolve) => {
      this.pendingReadResolve = resolve;
      this.requestRender();
    });
  }

  onCancelRunning(handler: (() => void) | null): void {
    this.cancelRunningHandler = handler;
  }

  private requestRender(): void {
    if (!this.tui) return;
    this.viewState.hints = this.getPromptHints();
    if (this.headerText) this.headerText.setText(this.viewState.header || XEQ_HEADER);
    this.viewState.transcript = this.getTranscriptText();
    if (this.transcriptText) this.transcriptText.setText(this.viewState.transcript);
    if (this.composerPanel) {
      this.composerPanel.setStatus(this.viewState.prompt);
      this.composerPanel.setSlashMenu(this.getSlashMenuText());
      this.composerPanel.setHints(this.viewState.hints);
    }
    this.tui.requestRender();
  }

  private hideApprovalOverlay(): void {
    if (!this.approvalOverlay) return;
    this.approvalOverlay.hide();
    this.approvalOverlay = null;
  }

  private getTranscriptText(): string {
    const committed = this.steps.join("\n\n");
    if (!this.assistantStreamText.trim()) {
      return committed;
    }
    return committed ? `${committed}\n\n${this.assistantStreamText}` : this.assistantStreamText;
  }

  private getPromptHints(): string {
    if (this.fixedPromptOptions && this.fixedPromptOptions.length > 0) {
      return `[${this.fixedPromptOptions.join(" · ")}]`;
    }

    if (this.shouldShowSlashMenu()) {
      return "[tab=autocomplete · enter=run · ctrl+u=clear · ctrl+d=quit]";
    }

    return "";
  }

  private shouldShowSlashMenu(): boolean {
    return /^\/\S*$/.test(this.currentInput.trim().toLowerCase()) && this.slashCommands.length > 0;
  }

  private getSlashMenuText(): string {
    if (!this.shouldShowSlashMenu()) {
      return "";
    }

    const query = this.currentInput.trim().toLowerCase();
    const matches = this.slashCommands
      .filter((command) => command.name.toLowerCase().startsWith(query))
      .slice(0, 8);
    const visible = matches.length > 0 ? matches : this.slashCommands.slice(0, 8);
    const width = visible.reduce((max, item) => Math.max(max, item.name.length), 0);

    return [
      "",
      ...visible.map((item, index) => {
        const prefix = index === 0 ? "> " : "  ";
        return `${prefix}${item.name.padEnd(width)}  ${item.description}`;
      }),
    ].join("\n");
  }

}
