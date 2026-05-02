import { classifyCommandRisk } from "@xeq/sandbox";
import type { ApprovalMode } from "@xeq/shared";
import type { TaskPhaseController } from "./task-flow.js";

export type ToolApprovalAction = "allow" | "ask" | "deny";

export function classifyToolCall(
  toolName: string,
  input: unknown,
): {
  permission: "read" | "edit" | "bash" | "web_fetch" | "patch_review" | "unknown";
  pattern: string;
  action: ToolApprovalAction;
} {
  if (["readFile", "listFiles", "grep"].includes(toolName)) {
    return { permission: "read", pattern: "*", action: "allow" };
  }

  if (["preparePatch", "preparePatchBundle"].includes(toolName)) {
    return { permission: "patch_review", pattern: "*", action: "allow" };
  }

  if (["writeFile", "editFile", "deleteFile"].includes(toolName)) {
    return { permission: "edit", pattern: filePattern(input), action: "ask" };
  }

  if (toolName === "bash") {
    const pattern = commandPattern(input);
    return {
      permission: "bash",
      pattern,
      action: classifyCommandRisk(pattern),
    };
  }

  if (toolName === "webFetch") {
    return { permission: "web_fetch", pattern: "*", action: "allow" };
  }

  return { permission: "unknown", pattern: toolName, action: "ask" };
}

type ApprovalHandler = (request: {
  kind: "command" | "file-write" | "web-fetch";
  target: string;
  details?: string;
}) => Promise<"reject" | "once" | "always">;

export function createToolApprovalHandler(opts: {
  approvalMode: ApprovalMode;
  phase: TaskPhaseController;
  patchApprovedPaths: Set<string>;
  requestApproval: ApprovalHandler;
}) {
  let lastToolSignature: string | null = null;
  let repeatedToolCount = 0;

  return async (toolCall: { toolName: string; input: unknown }): Promise<boolean> => {
    const decision = classifyToolCall(toolCall.toolName, toolCall.input);
    const signature = toolCallSignature(toolCall.toolName, toolCall.input);

    if (signature === lastToolSignature) {
      repeatedToolCount += 1;
    } else {
      lastToolSignature = signature;
      repeatedToolCount = 1;
    }

    if (repeatedToolCount >= 3) {
      const approval = await opts.requestApproval({
        kind: "command",
        target: `tool-repeat:${toolCall.toolName}`,
        details: `Repeated identical tool call detected (${repeatedToolCount}x).\n${truncate(
          signature,
          500,
        )}`,
      });
      if (approval === "reject") {
        return false;
      }
      repeatedToolCount = 0;
    }

    if (opts.phase.isContextPhase()) {
      return decision.permission === "read" || decision.permission === "web_fetch";
    }

    if (opts.phase.isVerificationPhase()) {
      if (decision.permission === "read" || decision.permission === "bash") {
        return true;
      }
      return false;
    }

    if (decision.action === "deny") {
      return false;
    }

    if (decision.permission === "read" || decision.permission === "patch_review") {
      return true;
    }

    if (decision.permission === "web_fetch") {
      return true;
    }

    if (decision.permission === "edit") {
      const target = decision.pattern;
      if (opts.approvalMode === "auto-edit" && opts.patchApprovedPaths.has(target)) {
        opts.patchApprovedPaths.delete(target);
        return true;
      }

      const approval = await opts.requestApproval({
        kind: "file-write",
        target,
      });
      return approval !== "reject";
    }

    if (decision.permission === "bash") {
      const approval = await opts.requestApproval({
        kind: "command",
        target: decision.pattern,
      });
      return approval !== "reject";
    }

    return false;
  };
}

function filePattern(input: unknown): string {
  if (!input || typeof input !== "object") return "*";
  const filePath = (input as { filePath?: unknown }).filePath;
  if (typeof filePath !== "string" || filePath.trim() === "") return "*";

  return filePath;
}

function commandPattern(input: unknown): string {
  if (!input || typeof input !== "object") return "*";
  const command = (input as { command?: unknown }).command;
  if (typeof command !== "string") return "*";

  return command.split(/\s+/).slice(0, 2).join(" ") || "*";
}

function toolCallSignature(toolName: string, input: unknown): string {
  return `${toolName}:${safeStableStringify(input)}`;
}

function safeStableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map(normalize);
    }

    if (input && typeof input === "object") {
      const obj = input as Record<string, unknown>;
      if (seen.has(obj)) {
        return "[circular]";
      }
      seen.add(obj);

      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = normalize(obj[key]);
          return acc;
        }, {});
    }

    return input;
  };

  try {
    return JSON.stringify(normalize(value));
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}…`;
}
