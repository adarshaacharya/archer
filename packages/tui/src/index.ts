import { Box, Container, Input, ProcessTerminal, Text, TUI } from "@mariozechner/pi-tui";
import type { AgentStep, RunSummary } from "@xeq/shared";
import { defaultTuiLayout } from "./layout.js";
import { xeqBranding } from "./theme.js";

export interface ApprovalPromptState {
  message: string;
  options?: string[];
}

export interface Tui {
  start(): Promise<void>;
  renderStep(step: AgentStep): void;
  renderApprovalPrompt(prompt: ApprovalPromptState | null): void;
  renderSummary(summary: RunSummary): void;
  readInputLine(): Promise<string>;
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
  private hintsText: Text | null = null;
  private input: Input | null = null;
  private pendingReadResolve: ((line: string) => void) | null = null;
  private steps: string[] = [];
  private viewState: TuiViewState = {
    header: "XEQ creative terminal coding agent",
    status: "ready  model=unknown  sandbox=local  tools=stub",
    transcript: "Waiting for first step...",
    prompt: ">",
    hints: `[${xeqBranding.promptHint}]`,
  };

  async start(): Promise<void> {
    this.terminal = new ProcessTerminal();
    this.enterAlternateScreen();
    this.tui = new TUI(this.terminal);

    this.rootContainer = new Container();
    this.headerText = new Text(`${XEQ_LOGO_TEXT}\n${this.viewState.header}\n${this.viewState.status}`, 0, 0);
    this.transcriptText = new Text(`Transcript\n${this.viewState.transcript}`, 0, 0);
    this.promptInfoText = new Text(this.viewState.prompt, 0, 0);
    this.input = new Input();
    this.hintsText = new Text(this.viewState.hints, 0, 0);

    const composer = new Box(0, 0);
    composer.addChild(this.promptInfoText);
    composer.addChild(this.input);
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
      if (this.pendingReadResolve) {
        const resolve = this.pendingReadResolve;
        this.pendingReadResolve = null;
        resolve(submit);
      }
      this.requestRender();
    };

    this.tui.start();
  }

  renderStep(step: AgentStep): void {
    const parts = [`[${step.step}] ${step.action}`];
    if (step.thought) parts.push(step.thought);
    if (step.observation) parts.push(step.observation);

    this.steps.push(parts.join(" | "));
    if (this.steps.length > defaultTuiLayout.maxStepsVisible) this.steps.shift();
    this.viewState.transcript = this.steps.join("\n\n");
    this.requestRender();
  }

  renderApprovalPrompt(prompt: ApprovalPromptState | null): void {
    if (!prompt) {
      this.viewState.prompt = ">";
      this.viewState.hints = `[${xeqBranding.promptHint}]`;
      this.requestRender();
      return;
    }

    this.viewState.prompt = prompt.message;
    this.viewState.hints =
      prompt.options && prompt.options.length > 0 ? `[${prompt.options.join(" · ")}]` : "";
    this.requestRender();
  }

  renderSummary(summary: RunSummary): void {
    this.viewState.status = `last_run=${summary.success ? "ok" : "failed"}  steps=${summary.steps}  duration_ms=${summary.durationMs}`;
    this.viewState.header = "XEQ ready";
    this.requestRender();
  }

  stop(): void {
    if (this.tui) this.tui.stop();
    this.exitAlternateScreen();
    this.tui = null;
    this.terminal = null;
    this.rootContainer = null;
    this.headerText = null;
    this.statusText = null;
    this.transcriptText = null;
    this.promptInfoText = null;
    this.hintsText = null;
    this.input = null;
    this.pendingReadResolve = null;
  }

  readInputLine(): Promise<string> {
    if (!this.tui || !this.input) return Promise.resolve("");
    this.tui.setFocus(this.input);
    return new Promise<string>((resolve) => {
      this.pendingReadResolve = resolve;
      this.requestRender();
    });
  }

  private requestRender(): void {
    if (!this.tui) return;
    if (this.headerText) this.headerText.setText(`${XEQ_LOGO_TEXT}\n${this.viewState.header}\n${this.viewState.status}`);
    if (this.transcriptText) this.transcriptText.setText(`Transcript\n${this.viewState.transcript}`);
    if (this.promptInfoText) this.promptInfoText.setText(this.viewState.prompt);
    if (this.hintsText) this.hintsText.setText(this.viewState.hints);
    this.tui.requestRender();
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
