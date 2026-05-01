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
  return async (toolCall: { toolName: string; input: unknown }): Promise<boolean> => {
    const decision = classifyToolCall(toolCall.toolName, toolCall.input);

    if (opts.phase.isContextPhase()) {
      return decision.permission === "read" || decision.permission === "web_fetch";
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
