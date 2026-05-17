import type { HarnessTurnRequest, HarnessTurnResult } from "./contracts.js";
import { HarnessEventBus } from "./event-bus.js";
import type { HarnessModelLoop } from "./model-loop.js";
import type { HarnessToolRouter } from "./tool-router.js";
import { HarnessTurnMachine } from "./turn-machine.js";

export class HarnessTurnRunner {
  constructor(
    private readonly modelLoop: HarnessModelLoop,
    private readonly toolRouter: HarnessToolRouter,
  ) {}

  async run(
    request: HarnessTurnRequest,
    options?: { onEvent?: (event: import("./contracts.js").HarnessEvent) => void },
  ): Promise<HarnessTurnResult> {
    const eventBus = new HarnessEventBus();
    if (options?.onEvent) {
      eventBus.subscribe(options.onEvent);
    }
    const turnMachine = new HarnessTurnMachine();

    try {
      turnMachine.transition("running", "turn started");
      eventBus.emit({ type: "turn.started", turnId: request.turnId, mode: request.mode });
      const observations: Array<{
        step: number;
        kind: "tool_result";
        toolName: string;
        output: unknown;
      }> = [];
      let finalText = "";
      let completedSteps = 0;
      const maxRecoveryAttempts = Math.max(0, request.maxRecoveryAttempts ?? 1);
      let recoveryAttempts = 0;

      for (let step = 1; step <= request.maxSteps; step += 1) {
        eventBus.emit({
          type: "turn.progress",
          turnId: request.turnId,
          step,
          action: "model.decide",
          detail: "started",
        });
        const decision = await this.modelLoop.decide({
          request,
          step,
          state: {
            prompt: request.prompt,
            observations,
          },
        });
        completedSteps = step;
        eventBus.emit({
          type: "turn.progress",
          turnId: request.turnId,
          step,
          action: "model.decide",
          detail: decision.type,
        });

        if (decision.type === "final") {
          finalText = decision.text.trim();
          break;
        }

        const toolResult = await this.toolRouter.execute({
          turnId: request.turnId,
          step,
          toolName: decision.toolName,
          args: decision.args,
          eventBus,
        });
        if (!toolResult.ok) {
          if (recoveryAttempts >= maxRecoveryAttempts) {
            throw new Error(toolResult.error);
          }
          recoveryAttempts += 1;
          observations.push({
            step,
            kind: "tool_result",
            toolName: decision.toolName,
            output: { error: toolResult.error, recoverable: true, recoveryAttempt: recoveryAttempts },
          });
          eventBus.emit({
            type: "turn.progress",
            turnId: request.turnId,
            step,
            action: "turn.recovery",
            detail: `retry ${recoveryAttempts}/${maxRecoveryAttempts}`,
          });
          continue;
        }
        observations.push({
          step,
          kind: "tool_result",
          toolName: decision.toolName,
          output: toolResult.output,
        });
      }

      if (!finalText) {
        throw new Error(`Turn exceeded maxSteps=${request.maxSteps}`);
      }

      turnMachine.transition("completed", "turn finished");
      eventBus.emit({
        type: "turn.completed",
        turnId: request.turnId,
        outputText: finalText,
        steps: completedSteps,
      });
      return { status: "completed", outputText: finalText, steps: completedSteps };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      turnMachine.transition("failed", "executor failed");
      eventBus.emit({ type: "turn.failed", turnId: request.turnId, error: message });
      return { status: "failed", outputText: "", steps: 0, error: message };
    }
  }
}
