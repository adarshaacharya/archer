export type PolicyDecision = "allow" | "ask" | "deny";

export interface SandboxPolicy {
  decidePathAccess(path: string, mode: "read" | "write"): PolicyDecision;
  decideCommand(command: string): PolicyDecision;
}

export class DefaultSandboxPolicy implements SandboxPolicy {
  constructor(private readonly workspaceRoot: string) {}

  decidePathAccess(path: string, mode: "read" | "write"): PolicyDecision {
    if (!path.startsWith(this.workspaceRoot)) return "deny";
    if (mode === "write" && path.includes("node_modules")) return "ask";
    return "allow";
  }

  decideCommand(command: string): PolicyDecision {
    const dangerous = ["rm -rf /", "sudo", "mkfs", "dd if="];
    if (dangerous.some((token) => command.includes(token))) return "deny";
    if (command.includes("git push") || command.includes("npm publish")) return "ask";
    return "allow";
  }
}
