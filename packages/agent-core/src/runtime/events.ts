import type { SessionEvent } from "@openharness/core";
import type { OpenHarnessRuntimeDeps } from "./openharness-types.js";

function formatToolOutput(output: unknown): string {
  if (output == null) {
    return "completed";
  }

  if (typeof output === "string") {
    return output.length > 2000 ? `${output.slice(0, 2000)}\n... truncated ...` : output;
  }

  try {
    const text = JSON.stringify(output, null, 2);
    return text.length > 2000 ? `${text.slice(0, 2000)}\n... truncated ...` : text;
  } catch {
    const text = String(output);
    return text.length > 2000 ? `${text.slice(0, 2000)}\n... truncated ...` : text;
  }
}

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
      onStep({
        step,
        action: `tool.${event.toolName}`,
        observation: formatToolOutput(event.output),
      });
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
