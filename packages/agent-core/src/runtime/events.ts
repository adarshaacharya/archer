import type { SessionEvent } from "@openharness/core";
import type { OpenHarnessRuntimeDeps } from "./openharness-types.js";

export function mapEvent(
  event: SessionEvent,
  onStep: OpenHarnessRuntimeDeps["onStep"],
  onTextDelta: OpenHarnessRuntimeDeps["onTextDelta"],
  step: number,
  onText: (delta: string) => void,
): void {
  switch (event.type) {
    case "text.delta":
      onTextDelta?.(event.text);
      onText(event.text);
      break;
    case "reasoning.delta":
      if (!onStep) return;
      onStep({ step, action: "model.reasoning", observation: event.text });
      break;
    case "tool.start":
      if (!onStep) return;
      onStep({ step, action: `tool.${event.toolName}`, observation: "started" });
      break;
    case "tool.done":
      if (!onStep) return;
      onStep({ step, action: `tool.${event.toolName}`, observation: "completed" });
      break;
    case "tool.error":
      if (!onStep) return;
      onStep({ step, action: `tool.${event.toolName}`, observation: event.error });
      break;
    case "error":
      if (!onStep) return;
      onStep({ step, action: "run.error", observation: event.error.message });
      break;
    default:
      break;
  }
}
