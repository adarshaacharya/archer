import { BoxRenderable, type CliRenderer, TextRenderable, createCliRenderer } from "@opentui/core";
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

export class OpenTui implements Tui {
  private renderer: CliRenderer | null = null;
  private steps: string[] = [];
  private welcomeText: TextRenderable | null = null;
  private statusText: TextRenderable | null = null;
  private stepsText: TextRenderable | null = null;
  private promptText: TextRenderable | null = null;

  async start(): Promise<void> {
    this.renderer = await createCliRenderer({
      useAlternateScreen: true,
      useMouse: true,
      exitOnCtrlC: false,
      targetFps: 30,
    });

    const frame = new BoxRenderable(this.renderer, {
      id: "xeq-frame",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      border: true,
      borderStyle: "single",
      title: xeqBranding.frameTitle,
      padding: defaultTuiLayout.framePadding,
      rowGap: defaultTuiLayout.frameRowGap,
      borderColor: xeqTheme.accentStrong,
    });

    const topRow = new BoxRenderable(this.renderer, {
      id: "top-row",
      width: "100%",
      height: 9,
      flexDirection: "column",
    });

    const welcomeBox = new BoxRenderable(this.renderer, {
      id: "welcome-box",
      width: "100%",
      border: true,
      title: "Welcome",
      padding: 1,
      borderColor: xeqTheme.border,
    });
    this.welcomeText = new TextRenderable(this.renderer, {
      id: "welcome-text",
      content:
        "██╗  ██╗███████╗ ██████╗\n" +
        "╚██╗██╔╝██╔════╝██╔═══██╗\n" +
        " ╚███╔╝ █████╗  ██║   ██║\n" +
        " ██╔██╗ ██╔══╝  ██║▄▄ ██║\n" +
        "██╔╝ ██╗███████╗╚██████╔╝\n" +
        "╚═╝  ╚═╝╚══════╝ ╚══▀▀═╝\n" +
        "Terminal coding agent",
      width: "100%",
      fg: xeqTheme.accentStrong,
    });
    topRow.add(welcomeBox);
    welcomeBox.add(this.welcomeText);

    const statusRow = new BoxRenderable(this.renderer, {
      id: "status-row",
      width: "100%",
      border: true,
      title: "Status",
      padding: 1,
      minHeight: defaultTuiLayout.headerMinHeight,
      borderColor: xeqTheme.border,
    });
    this.statusText = new TextRenderable(this.renderer, {
      id: "status-text",
      content: "ready | model=unknown | sandbox=local | tools=stub",
      width: "100%",
      fg: xeqTheme.muted,
    });
    statusRow.add(this.statusText);

    const stepsBox = new BoxRenderable(this.renderer, {
      id: "steps-box",
      width: "100%",
      flexGrow: 1,
      border: true,
      title: xeqBranding.streamTitle,
      padding: 1,
      borderColor: xeqTheme.border,
    });
    this.stepsText = new TextRenderable(this.renderer, {
      id: "steps-text",
      content: "Waiting for first step...",
      width: "100%",
      height: "100%",
      fg: xeqTheme.text,
    });
    stepsBox.add(this.stepsText);

    const promptBox = new BoxRenderable(this.renderer, {
      id: "prompt-box",
      width: "100%",
      border: true,
      title: "Prompt",
      padding: 1,
      minHeight: defaultTuiLayout.approvalMinHeight,
      borderColor: xeqTheme.accent,
    });
    this.promptText = new TextRenderable(this.renderer, {
      id: "prompt-text",
      content: `> Type your task (${xeqBranding.promptHint})`,
      width: "100%",
      fg: xeqTheme.muted,
    });
    promptBox.add(this.promptText);

    frame.add(topRow);
    frame.add(statusRow);
    frame.add(stepsBox);
    frame.add(promptBox);

    this.renderer.root.add(frame);
    this.renderer.start();
    this.renderer.requestRender();
  }

  renderStep(step: AgentStep): void {
    const parts: string[] = [];
    parts.push(`[${step.step}] Action: ${step.action}`);
    if (step.thought) parts.push(`Thought: ${step.thought}`);
    if (step.observation) parts.push(`Observation: ${step.observation}`);

    this.steps.push(parts.join("\n"));
    if (this.steps.length > defaultTuiLayout.maxStepsVisible) this.steps.shift();

    if (this.stepsText) this.stepsText.content = this.steps.join("\n\n");
    this.requestRender();
  }

  renderApprovalPrompt(prompt: ApprovalPromptState | null): void {
    if (!this.promptText) return;

    if (!prompt) {
      this.promptText.content = `> Type your task (${xeqBranding.promptHint})`;
      this.requestRender();
      return;
    }

    const optionsText =
      prompt.options && prompt.options.length > 0 ? `\nOptions: ${prompt.options.join(" / ")}` : "";
    this.promptText.content = `${prompt.message}${optionsText}`;
    this.requestRender();
  }

  renderSummary(summary: RunSummary): void {
    if (this.statusText) {
      this.statusText.content = `result=${summary.success ? "ok" : "failed"} | steps=${summary.steps} | durationMs=${summary.durationMs} | at=${new Date().toLocaleTimeString()}`;
    }
    if (this.welcomeText) {
      this.welcomeText.content = "XEQ ready for next task";
      this.welcomeText.fg = xeqTheme.text;
    }
    this.requestRender();
  }

  stop(): void {
    if (!this.renderer) return;
    this.renderer.destroy();
    this.renderer = null;
  }

  private requestRender(): void {
    this.renderer?.requestRender();
  }
}
