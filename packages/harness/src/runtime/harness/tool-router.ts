import type { HarnessEventBus } from "./event-bus.js";
import type { HarnessPolicyApprovalResolver } from "./policy-engine.js";
import { HarnessPolicyEngine } from "./policy-engine.js";

export type HarnessToolHandler = (args: unknown) => Promise<unknown>;

export class HarnessToolRouter {
  private readonly handlers = new Map<string, HarnessToolHandler>();

  constructor(
    private readonly policy: HarnessPolicyEngine,
    private readonly requestApproval?: HarnessPolicyApprovalResolver,
  ) {}

  registerTool(toolName: string, handler: HarnessToolHandler): void {
    this.handlers.set(toolName, handler);
  }

  async execute(params: {
    turnId: string;
    step: number;
    toolName: string;
    args: unknown;
    eventBus: HarnessEventBus;
  }): Promise<{ ok: true; output: unknown } | { ok: false; error: string }> {
    const { turnId, step, toolName, args, eventBus } = params;

    eventBus.emit({
      type: "turn.progress",
      turnId,
      step,
      action: `tool.${toolName}`,
      detail: "requested",
    });

    const auth = await this.policy.authorize(
      { toolName, args },
      this.requestApproval,
    );
    if (!auth.allowed) {
      eventBus.emit({
        type: "turn.awaiting_approval",
        turnId,
        reason: `${toolName}: ${auth.decision.reason}`,
      });
      return { ok: false, error: `Denied by policy: ${auth.decision.reason}` };
    }

    const handler = this.handlers.get(toolName);
    if (!handler) {
      return { ok: false, error: `Unknown tool: ${toolName}` };
    }

    try {
      const output = await handler(args);
      eventBus.emit({
        type: "turn.progress",
        turnId,
        step,
        action: `tool.${toolName}`,
        detail: "completed",
      });
      return { ok: true, output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      eventBus.emit({
        type: "turn.failed",
        turnId,
        error: `Tool ${toolName} failed: ${message}`,
      });
      return { ok: false, error: message };
    }
  }
}
