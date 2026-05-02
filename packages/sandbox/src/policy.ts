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

    if (mode === "write") {
      if (relativePath.startsWith(".git/")) {
        return "ask";
      }

      return "ask";
    }

    return "allow";
  }

  decideCommand(command: string): PolicyDecision {
    return classifyCommandRisk(command);
  }
}

const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bmkfs\b/i,
  /\bdd\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fdx\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

const NETWORK_PATTERNS: RegExp[] = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\bsftp\b/i,
  /\bftp\b/i,
  /\bnc\b/i,
  /\bnetcat\b/i,
];

const MUTATING_PATTERNS: RegExp[] = [
  /\bgit\s+push\b/i,
  /\bgit\s+commit\b/i,
  /\bgit\s+merge\b/i,
  /\bgit\s+rebase\b/i,
  /\bgit\s+fetch\b/i,
  /\bgit\s+pull\b/i,
  /\bgit\s+cherry-pick\b/i,
  /\bnpm\s+(?:install|add|update|upgrade|remove|uninstall|publish)\b/i,
  /\bpnpm\s+(?:install|add|update|upgrade|remove|uninstall|publish)\b/i,
  /\byarn\s+(?:install|add|update|upgrade|remove|uninstall|publish)\b/i,
  /\bbun\s+(?:install|add|update|upgrade|remove|uninstall|publish)\b/i,
];

const SAFE_PATTERNS: RegExp[] = [
  /^\s*pwd\b/i,
  /^\s*whoami\b/i,
  /^\s*echo\b/i,
  /^\s*true\b/i,
  /^\s*false\b/i,
  /^\s*uname\b/i,
  /^\s*ls\b/i,
  /^\s*find\b/i,
  /^\s*cat\b/i,
  /^\s*head\b/i,
  /^\s*tail\b/i,
  /^\s*grep\b/i,
  /^\s*rg\b/i,
  /^\s*sed\b/i,
  /^\s*awk\b/i,
  /^\s*tree\b/i,
  /^\s*git\s+(?:status|diff|branch|log|show|rev-parse)\b/i,
  /^\s*(?:bun\s+test|bun\s+run\s+(?:check-types|lint|test|typecheck|build))\b/i,
  /^\s*(?:npm|pnpm|yarn)\s+test\b/i,
  /^\s*(?:cargo|go)\s+test\b/i,
  /^\s*pytest\b/i,
  /^\s*make\s+test\b/i,
  /^\s*tsc\b/i,
  /^\s*biome\s+check\b/i,
  /^\s*eslint\b/i,
  /^\s*prettier\b/i,
];

export function classifyCommandRisk(command: string): PolicyDecision {
  const normalized = command.trim();
  if (!normalized) {
    return "deny";
  }

  if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "deny";
  }

  if (SAFE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "allow";
  }

  if (
    NETWORK_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    MUTATING_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return "ask";
  }

  return "ask";
}
