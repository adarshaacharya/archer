import { relative, resolve } from "node:path";

export type PolicyDecision = "allow" | "ask" | "deny";

export interface SandboxPolicy {
  decidePathAccess(path: string, mode: "read" | "write"): PolicyDecision;
  decideCommand(command: string): PolicyDecision;
}

export class DefaultSandboxPolicy implements SandboxPolicy {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = resolve(workspaceRoot);
  }

  decidePathAccess(path: string, mode: "read" | "write"): PolicyDecision {
    const targetPath = resolve(path);
    const relativePath = relative(this.workspaceRoot, targetPath);
    const escapesWorkspace =
      relativePath === "" ? false : relativePath.startsWith("..") || relativePath.includes("/../");

    if (escapesWorkspace) {
      return "deny";
    }

    if (mode === "write" && relativePath.startsWith(".git/")) {
      return "ask";
    }

    return "allow";
  }

  decideCommand(command: string): PolicyDecision {
    const dangerous = ["rm -rf /", "sudo", "mkfs", "dd if="];
    if (dangerous.some((token) => command.includes(token))) return "deny";
    return "allow";
  }
}
