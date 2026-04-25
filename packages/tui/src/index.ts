import {
  Box,
  Container,
  Input,
  Key,
  ProcessTerminal,
  TUI,
  Text,
  matchesKey,
} from "@mariozechner/pi-tui";
import type { AgentStep, RunSummary } from "@xeq/shared";
import { defaultTuiLayout } from "./layout.js";

export interface ApprovalPromptState {
  message: string;
  options?: string[];
}

export interface SlashCommandItem {
  name: string;
  description: string;
}

export interface Tui {
  start(): Promise<void>;
  renderStep(step: AgentStep): void;
  renderAssistantDelta(delta: string): void;
  finalizeAssistantStream(text?: string): void;
  renderApprovalPrompt(prompt: ApprovalPromptState | null): void;
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

const XEQ_LOGO_TEXT = [
  "██╗  ██╗███████╗ ██████╗",
  "╚██╗██╔╝██╔════╝██╔═══██╗",
  " ╚███╔╝ █████╗  ██║   ██║",
  " ██╔██╗ ██╔══╝  ██║▄▄ ██║",
  "██╔╝ ██╗███████╗╚██████╔╝",
  "╚═╝  ╚═╝╚══════╝ ╚══▀▀═╝",
].join("\n");

export class PiTui implements Tui {
  private terminal: ProcessTerminal | null = null;
  private tui: TUI | null = null;
  private rootContainer: Container | null = null;
  private headerText: Text | null = null;
  private statusText: Text | null = null;
  private transcriptText: Text | null = null;
  private promptInfoText: Text | null = null;
  private slashMenuText: Text | null = null;
  private hintsText: Text | null = null;
  private input: Input | null = null;
  private removeInputListener: (() => void) | null = null;
  private cancelRunningHandler: (() => void) | null = null;
  private pendingReadResolve: ((line: string) => void) | null = null;
  private slashCommands: SlashCommandItem[] = [];
  private fixedPromptOptions: string[] | null = null;
  private currentInput = "";
  private steps: string[] = [];
  private assistantStreamText = "";
  private viewState: TuiViewState = {
    header: "XEQ",
    status: "",
    transcript: "",
    prompt: ">",
    hints: "",
  };

  async start(): Promise<void> {
    this.terminal = new ProcessTerminal();
    this.enterAlternateScreen();
    this.tui = new TUI(this.terminal);

    this.rootContainer = new Container();
    this.headerText = new Text(`${XEQ_LOGO_TEXT}\n${this.viewState.header}`, 0, 0);
    this.transcriptText = new Text(this.viewState.transcript, 0, 0);
    this.promptInfoText = new Text(this.viewState.prompt, 0, 0);
    this.input = new Input();
    this.slashMenuText = new Text("", 0, 0);
    this.hintsText = new Text(this.viewState.hints, 0, 0);

    const composer = new Box(0, 0);
    composer.addChild(this.promptInfoText);
    composer.addChild(this.input);
    composer.addChild(this.slashMenuText);
    composer.addChild(this.hintsText);

    this.rootContainer.addChild(this.headerText);
    this.rootContainer.addChild(new Text("", 0, 0));
    this.rootContainer.addChild(this.transcriptText);
    this.rootContainer.addChild(new Text("", 0, 0));
    this.rootContainer.addChild(composer);

    this.tui.addChild(this.rootContainer);
    this.tui.setFocus(this.input);

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

    this.removeInputListener = this.tui.addInputListener((data) => {
      if (matchesKey(data, Key.escape)) {
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

  renderStep(step: AgentStep): void {
    const parts = [`[${step.step}] ${step.action}`];
    if (step.thought) parts.push(step.thought);
    if (step.observation) parts.push(step.observation);

    this.steps.push(parts.join(" | "));
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
      this.viewState.prompt = "";
      this.fixedPromptOptions = null;
      this.viewState.hints = this.getPromptHints();
      this.requestRender();
      return;
    }

    this.viewState.prompt = prompt.message;
    this.fixedPromptOptions = prompt.options ?? null;
    this.viewState.hints = this.getPromptHints();
    this.requestRender();
  }

  renderSummary(_summary: RunSummary): void {
    this.viewState.header = "XEQ ready";
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
    this.exitAlternateScreen();
    this.tui = null;
    this.terminal = null;
    this.rootContainer = null;
    this.headerText = null;
    this.statusText = null;
    this.transcriptText = null;
    this.promptInfoText = null;
    this.slashMenuText = null;
    this.hintsText = null;
    this.input = null;
    this.pendingReadResolve = null;
    this.removeInputListener = null;
    this.cancelRunningHandler = null;
  }

  readInputLine(): Promise<string> {
    if (!this.tui || !this.input) return Promise.resolve("");
    this.tui.setFocus(this.input);
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
    if (this.headerText)
      this.headerText.setText(
        [XEQ_LOGO_TEXT, this.viewState.header, this.viewState.status].filter(Boolean).join("\n"),
      );
    this.viewState.transcript = this.getTranscriptText();
    if (this.transcriptText) this.transcriptText.setText(this.viewState.transcript);
    if (this.promptInfoText) this.promptInfoText.setText(this.viewState.prompt);
    if (this.slashMenuText) this.slashMenuText.setText(this.getSlashMenuText());
    if (this.hintsText) this.hintsText.setText(this.viewState.hints);
    this.tui.requestRender();
  }

  private getTranscriptText(): string {
    const committed = this.steps.join("\n\n");
    if (!this.assistantStreamText.trim()) {
      return committed;
    }

    const liveBlock = `[streaming]\n${this.assistantStreamText}`;
    return committed ? `${committed}\n\n${liveBlock}` : liveBlock;
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

  private enterAlternateScreen(): void {
    if (!this.terminal) return;
    // Enter alternate screen and clear to top-left.
    this.terminal.write("\x1b[?1049h\x1b[2J\x1b[H");
  }

  private exitAlternateScreen(): void {
    if (!this.terminal) return;
    // Return to normal terminal buffer.
    this.terminal.write("\x1b[?1049l");
  }
}
