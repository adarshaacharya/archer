import { relative, resolve } from "node:path";
import {
  type ApprovalMode,
  autoApproveCommandsInApprovalMode,
  canWriteInApprovalMode,
} from "@archer/shared/approval";
import { analyzeShellCommand } from "./command-analysis.js";

export type PolicyDecision = "allow" | "ask" | "deny";

export interface SandboxPolicy {
  decidePathAccess(path: string, mode: "read" | "write"): PolicyDecision;
  decideCommand(command: string): PolicyDecision;
}

export class DefaultSandboxPolicy implements SandboxPolicy {
  private readonly workspaceRoot: string;
  private readonly approvalMode: ApprovalMode;

  constructor(workspaceRoot: string, approvalMode: ApprovalMode = "workspace-write") {
    this.workspaceRoot = resolve(workspaceRoot);
    this.approvalMode = approvalMode;
  }

  decidePathAccess(path: string, mode: "read" | "write"): PolicyDecision {
    const targetPath = resolve(path);
    const relativePath = relative(this.workspaceRoot, targetPath);
    const escapesWorkspace =
      relativePath === "" ? false : relativePath.startsWith("..") || relativePath.includes("/../");

    if (escapesWorkspace) {
      return "deny";
    }

    if (mode === "write") {
      if (!canWriteInApprovalMode(this.approvalMode)) {
        return "deny";
      }

      if (this.approvalMode === "danger-full-access") {
        return "allow";
      }

      if (relativePath.startsWith(".git/")) {
        return "ask";
      }

      return "ask";
    }

    return "allow";
  }

  decideCommand(command: string): PolicyDecision {
    return classifyCommandRisk(command, this.approvalMode);
  }
}

export function classifyCommandRisk(
  command: string,
  approvalMode: ApprovalMode = "workspace-write",
): PolicyDecision {
  const analysis = analyzeShellCommand(command);
  if (analysis.kind === "too-complex" && command.trim() === "") {
    return "deny";
  }

  if (analysis.risk === "deny") {
    return "deny";
  }

  if (analysis.risk === "allow") {
    return "allow";
  }

  if (autoApproveCommandsInApprovalMode(approvalMode)) {
    return "allow";
  }

  return "ask";
}
