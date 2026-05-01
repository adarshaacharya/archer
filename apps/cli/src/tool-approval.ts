import { classifyToolCall } from "@xeq/agent-core";
import type { ToolCallInfo } from "@openharness/core";
import { type ApprovalChoice } from "@xeq/sandbox";
import type { ApprovalMode } from "@xeq/shared";
import type { LocalApprovalRequest } from "./approvals.js";

type ApprovalHandler = (request: LocalApprovalRequest) => Promise<ApprovalChoice>;

export function createToolApprovalHandler(opts: {
  approvalMode: ApprovalMode;
  patchApprovedPaths: Set<string>;
  requestApproval: ApprovalHandler;
}) {
  return async (toolCall: ToolCallInfo): Promise<boolean> => {
    const decision = classifyToolCall(toolCall.toolName, toolCall.input);

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
