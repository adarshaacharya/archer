import React from "react";
import { Box, Text, render, type Instance } from "ink";
import type { AgentStep, RunSummary } from "@xeq/shared";
import { defaultTuiLayout } from "./layout.js";
import { xeqBranding, xeqTheme } from "./theme.js";

export interface ApprovalPromptState {
  message: string;
  options?: string[];
}

export interface Tui {
  start(): Promise<void>;
  renderStep(step: AgentStep): void;
  renderApprovalPrompt(prompt: ApprovalPromptState | null): void;
  renderSummary(summary: RunSummary): void;
  stop(): void;
}

type TuiViewProps = {
  headerText: string;
  statusText: string;
  stepsText: string;
  promptLine: string;
  footerHints: string;
};

const XEQ_LOGO = [
  "██╗  ██╗███████╗ ██████╗ ",
  "╚██╗██╔╝██╔════╝██╔═══██╗",
  " ╚███╔╝ █████╗  ██║   ██║",
  " ██╔██╗ ██╔══╝  ██║▄▄ ██║",
  "██╔╝ ██╗███████╗╚██████╔╝",
  "╚═╝  ╚═╝╚══════╝ ╚══▀▀═╝ ",
].join("\n");

function TuiView({
  headerText,
  statusText,
  stepsText,
  promptLine,
  footerHints,
}: TuiViewProps): React.ReactElement {
  return React.createElement(
    Box,
    { flexDirection: "column", paddingX: defaultTuiLayout.framePadding, paddingY: 0, height: "100%" },
    React.createElement(Box, { flexDirection: "column", marginBottom: 1 }, 
      React.createElement(Text, { color: xeqTheme.accentStrong }, XEQ_LOGO),
      React.createElement(Text, { color: xeqTheme.text }, headerText),
      React.createElement(Text, { color: xeqTheme.muted }, statusText),
    ),
    React.createElement(Text, {}, ""),
    React.createElement(Text, { color: xeqTheme.accent }, "Transcript"),
    React.createElement(Box, { flexGrow: 1 }, React.createElement(Text, { color: xeqTheme.text }, stepsText)),
    React.createElement(Text, {}, ""),
    React.createElement(
      Box,
      {
        borderStyle: "round",
        borderColor: xeqTheme.accent,
        flexDirection: "column",
        paddingX: 1,
      },
      React.createElement(Text, { color: xeqTheme.surface }, " ".repeat(120)),
      React.createElement(Text, { color: xeqTheme.text }, promptLine),
      React.createElement(Text, { color: xeqTheme.surface }, " ".repeat(120)),
    ),
    React.createElement(Text, { color: xeqTheme.muted }, footerHints),
  );
}

export class InkTui implements Tui {
  private ink: Instance | null = null;
  private steps: string[] = [];
  private headerText = "XEQ  creative terminal coding agent";
  private statusText = "ready  model=unknown  sandbox=local  tools=stub";
  private stepsText = "Waiting for first step...";
  private promptLine = ">";
  private footerHints = `[${xeqBranding.promptHint}]`;

  async start(): Promise<void> {
    this.enterAlternateScreen();
    this.ink = render(this.createView(), {
      exitOnCtrlC: false,
      patchConsole: false,
    });
  }

  renderStep(step: AgentStep): void {
    const parts = [`[${step.step}] ${step.action}`];
    if (step.thought) parts.push(step.thought);
    if (step.observation) parts.push(step.observation);
    this.steps.push(parts.join(" | "));
    if (this.steps.length > defaultTuiLayout.maxStepsVisible) this.steps.shift();

    this.stepsText = this.steps.join("\n\n");
    this.requestRender();
  }

  renderApprovalPrompt(prompt: ApprovalPromptState | null): void {
    if (!prompt) {
      this.promptLine = ">";
      this.footerHints = `[${xeqBranding.promptHint}]`;
      this.requestRender();
      return;
    }

    this.promptLine = prompt.message;
    this.footerHints =
      prompt.options && prompt.options.length > 0 ? `[${prompt.options.join(" · ")}]` : "";
    this.requestRender();
  }

  renderSummary(summary: RunSummary): void {
    this.statusText = `last_run=${summary.success ? "ok" : "failed"}  steps=${summary.steps}  duration_ms=${summary.durationMs}`;
    this.headerText = "XEQ ready";
    this.requestRender();
  }

  stop(): void {
    if (!this.ink) return;
    this.ink.unmount();
    this.ink = null;
    this.exitAlternateScreen();
  }

  private requestRender(): void {
    if (!this.ink) return;
    this.ink.rerender(this.createView());
  }

  private createView(): React.ReactElement {
    return React.createElement(TuiView, {
      headerText: this.headerText,
      statusText: this.statusText,
      stepsText: this.stepsText,
      promptLine: this.promptLine,
      footerHints: this.footerHints,
    });
  }

  private enterAlternateScreen(): void {
    if (!process.stdout.isTTY) return;
    // DECSET 1049: switch to alternate screen buffer, then clear + home.
    process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");
  }

  private exitAlternateScreen(): void {
    if (!process.stdout.isTTY) return;
    // DECRST 1049: restore normal screen buffer.
    process.stdout.write("\x1b[?1049l");
  }
}
