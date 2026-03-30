import {
  BoxRenderable,
  createCliRenderer,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { AgentStep, RunSummary } from "@xeq/shared";

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
  private headerText: TextRenderable | null = null;
  private stepsText: TextRenderable | null = null;
  private approvalText: TextRenderable | null = null;
  private summaryText: TextRenderable | null = null;

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
      title: "XEQ",
      padding: 1,
      rowGap: 1,
    });

    const header = new BoxRenderable(this.renderer, {
      id: "header-box",
      width: "100%",
      border: true,
      title: "Session",
      padding: 1,
      minHeight: 3,
    });
    this.headerText = new TextRenderable(this.renderer, {
      id: "header-text",
      content: "XEQ session started",
      width: "100%",
    });
    header.add(this.headerText);

    const stepsBox = new BoxRenderable(this.renderer, {
      id: "steps-box",
      width: "100%",
      flexGrow: 1,
      border: true,
      title: "Step Stream",
      padding: 1,
    });
    this.stepsText = new TextRenderable(this.renderer, {
      id: "steps-text",
      content: "Waiting for first step...",
      width: "100%",
      height: "100%",
    });
    stepsBox.add(this.stepsText);

    const approvalBox = new BoxRenderable(this.renderer, {
      id: "approval-box",
      width: "100%",
      border: true,
      title: "Approval",
      padding: 1,
      minHeight: 3,
    });
    this.approvalText = new TextRenderable(this.renderer, {
      id: "approval-text",
      content: "No approval pending",
      width: "100%",
    });
    approvalBox.add(this.approvalText);

    const summaryBox = new BoxRenderable(this.renderer, {
      id: "summary-box",
      width: "100%",
      border: true,
      title: "Summary",
      padding: 1,
      minHeight: 3,
    });
    this.summaryText = new TextRenderable(this.renderer, {
      id: "summary-text",
      content: "No run summary yet",
      width: "100%",
    });
    summaryBox.add(this.summaryText);

    frame.add(header);
    frame.add(stepsBox);
    frame.add(approvalBox);
    frame.add(summaryBox);

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
    if (this.steps.length > 50) this.steps.shift();

    if (this.stepsText) this.stepsText.content = this.steps.join("\n\n");
    this.requestRender();
  }

  renderApprovalPrompt(prompt: ApprovalPromptState | null): void {
    if (!this.approvalText) return;

    if (!prompt) {
      this.approvalText.content = "No approval pending";
      this.requestRender();
      return;
    }

    const optionsText =
      prompt.options && prompt.options.length > 0
        ? `\nOptions: ${prompt.options.join(" / ")}`
        : "";
    this.approvalText.content = `${prompt.message}${optionsText}`;
    this.requestRender();
  }

  renderSummary(summary: RunSummary): void {
    if (this.summaryText) {
      this.summaryText.content =
        `success=${summary.success}\n` +
        `steps=${summary.steps}\n` +
        `durationMs=${summary.durationMs}\n` +
        `costUsd=${summary.estimatedCostUsd.toFixed(6)}`;
    }
    if (this.headerText) {
      this.headerText.content = `Run complete at ${new Date().toLocaleTimeString()}`;
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

export class ConsoleTui implements Tui {
  async start(): Promise<void> {
    process.stdout.write("XEQ session started\n");
  }

  renderStep(step: AgentStep): void {
    const thought = step.thought ? `\nThought: ${step.thought}` : "";
    const observation = step.observation
      ? `\nObservation: ${step.observation}`
      : "";

    process.stdout.write(
      `\n[Step ${step.step}]\nAction: ${step.action}${thought}${observation}\n`,
    );
  }

  renderApprovalPrompt(prompt: ApprovalPromptState | null): void {
    if (!prompt) {
      process.stdout.write("\n[Approval] none\n");
      return;
    }
    const options =
      prompt.options && prompt.options.length > 0
        ? ` (${prompt.options.join("/")})`
        : "";
    process.stdout.write(`\n[Approval] ${prompt.message}${options}\n`);
  }

  renderSummary(summary: RunSummary): void {
    process.stdout.write(
      `\nDone: ${summary.success ? "yes" : "no"} | steps=${summary.steps} | durationMs=${summary.durationMs} | cost=$${summary.estimatedCostUsd.toFixed(6)}\n`,
    );
  }

  stop(): void {
    process.stdout.write("XEQ session ended\n");
  }
}
