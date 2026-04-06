import type { SessionEvent } from "@openharness/core";
import type { OpenHarnessRuntimeDeps } from "./openharness-types.js";

export function mapEvent(
  event: SessionEvent,
  onStep: OpenHarnessRuntimeDeps["onStep"],
  step: number,
  onText: (delta: string) => void,
): void {
  if (!onStep) return;

  switch (event.type) {
    case "text.delta":
      onText(event.text);
      break;
    case "reasoning.delta":
      onStep({ step, action: "model.reasoning", observation: event.text });
      break;
    case "tool.start":
      onStep({ step, action: `tool.${event.toolName}`, observation: "started" });
      break;
    case "tool.done":
      onStep({ step, action: `tool.${event.toolName}`, observation: "completed" });
      break;
    case "tool.error":
      onStep({ step, action: `tool.${event.toolName}`, observation: event.error });
      break;
    case "error":
      onStep({ step, action: "run.error", observation: event.error.message });
      break;
    default:
      break;
  }
}
