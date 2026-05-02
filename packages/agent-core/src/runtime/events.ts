import type { SessionEvent } from "@openharness/core";
import type { OpenHarnessRuntimeDeps } from "./openharness-types.js";

function isShellResult(output: unknown): output is {
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: unknown;
} {
  return typeof output === "object" && output !== null && "exitCode" in output;
}

function formatToolOutput(output: unknown): string {
  if (output == null) {
    return "completed";
  }

  if (typeof output === "string") {
    return output.length > 2000 ? `${output.slice(0, 2000)}\n... truncated ...` : output;
  }

  if (isShellResult(output)) {
    const stdout = typeof output.stdout === "string" ? output.stdout.trimEnd() : "";
    const stderr = typeof output.stderr === "string" ? output.stderr.trimEnd() : "";
    const exitCode = typeof output.exitCode === "number" ? output.exitCode : undefined;
    const text = [
      stdout,
      stderr ? `stderr:\n${stderr}` : "",
      exitCode && exitCode !== 0 ? `exitCode=${exitCode}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return text || (exitCode === 0 ? "completed" : `exitCode=${exitCode ?? "unknown"}`);
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
  onToolEvent: OpenHarnessRuntimeDeps["onToolEvent"],
  onTextDelta: OpenHarnessRuntimeDeps["onTextDelta"],
  onUsage: OpenHarnessRuntimeDeps["onUsage"],
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
      onToolEvent?.({ phase: "start", step, toolName: event.toolName });
      if (!onStep) return;
      onStep({ step, action: `tool.${event.toolName}`, observation: "started" });
      break;
    case "tool.done":
      onToolEvent?.({ phase: "done", step, toolName: event.toolName, output: event.output });
      if (!onStep) return;
      onStep({
        step,
        action: `tool.${event.toolName}`,
        observation: formatToolOutput(event.output),
      });
      break;
    case "tool.error":
      onToolEvent?.({ phase: "error", step, toolName: event.toolName, error: event.error });
      if (!onStep) return;
      onStep({ step, action: `tool.${event.toolName}`, observation: event.error });
      break;
    case "step.done":
      onUsage?.(
        {
          promptTokens: event.usage.inputTokens ?? 0,
          completionTokens: event.usage.outputTokens ?? 0,
          totalTokens: event.usage.totalTokens ?? 0,
        },
        false,
      );
      break;
    case "error":
      if (!onStep) return;
      onStep({ step, action: "run.error", observation: event.error.message });
      break;
    case "done":
      onUsage?.(
        {
          promptTokens: event.totalUsage.inputTokens ?? 0,
          completionTokens: event.totalUsage.outputTokens ?? 0,
          totalTokens: event.totalUsage.totalTokens ?? 0,
        },
        true,
      );
      break;
    default:
      break;
  }
}
