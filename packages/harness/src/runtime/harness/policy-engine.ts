export type HarnessPermission = "read" | "edit" | "bash" | "web" | "unknown";
export type HarnessPolicyAction = "allow" | "ask" | "deny";

export type HarnessPolicyDecision = {
  permission: HarnessPermission;
  action: HarnessPolicyAction;
  reason: string;
};

export type HarnessPolicyInput = {
  toolName: string;
  args: unknown;
  mode?: "answer" | "change";
  subagent?: boolean;
};

export type HarnessPolicyApprovalResolver = (request: {
  toolName: string;
  permission: HarnessPermission;
  reason: string;
}) => Promise<boolean>;

export type HarnessPolicyRule = {
  id: string;
  priority: number;
  permission: HarnessPermission;
  action: HarnessPolicyAction;
  reason: string;
  tool: string | string[];
  mode?: "answer" | "change" | "any";
  subagent?: boolean | "any";
  when?: {
    bashPrefixes?: string[];
    argsPattern?: unknown;
  };
};

const DEFAULT_RULES: HarnessPolicyRule[] = [
  {
    id: "read-tools",
    priority: 100,
    permission: "read",
    action: "allow",
    reason: "read tool",
    tool: ["readFile", "listFiles", "grep"],
  },
  {
    id: "web-tools",
    priority: 100,
    permission: "web",
    action: "allow",
    reason: "web tool",
    tool: ["webSearch", "webOpenPage", "webFindInPage"],
  },
  {
    id: "edit-tools",
    priority: 80,
    permission: "edit",
    action: "ask",
    reason: "edit tool requires approval",
    tool: ["preparePatch", "preparePatchBundle", "createDirectory", "writeFile", "editFile", "deleteFile"],
  },
  {
    id: "bash-dangerous",
    priority: 200,
    permission: "bash",
    action: "deny",
    reason: "dangerous command",
    tool: "bash",
    when: {
      bashPrefixes: ["rm -rf", "sudo rm", "mkfs", "dd if="],
    },
  },
  {
    id: "bash-trusted",
    priority: 120,
    permission: "bash",
    action: "allow",
    reason: "trusted command",
    tool: "bash",
    when: {
      bashPrefixes: ["ls", "pwd", "cat", "git status", "rg", "find"],
    },
  },
  {
    id: "bash-untrusted",
    priority: 10,
    permission: "bash",
    action: "ask",
    reason: "untrusted command",
    tool: "bash",
  },
  {
    id: "unknown-tools",
    priority: 0,
    permission: "unknown",
    action: "ask",
    reason: "unknown tool",
    tool: "*",
  },
];

export class HarnessPolicyEngine {
  private readonly rules: HarnessPolicyRule[];

  constructor(options?: { rules?: HarnessPolicyRule[] }) {
    const rules = options?.rules ?? DEFAULT_RULES;
    this.rules = [...rules].sort((a, b) => b.priority - a.priority);
  }

  classify(input: HarnessPolicyInput): HarnessPolicyDecision {
    for (const rule of this.rules) {
      if (!this.matchesRule(rule, input)) {
        continue;
      }
      const command = this.commandPattern(input.args);
      const suffix = command ? `: ${command}` : "";
      return {
        permission: rule.permission,
        action: rule.action,
        reason: `${rule.reason}${suffix}`,
      };
    }
    return { permission: "unknown", action: "ask", reason: "no matching policy rule" };
  }

  async authorize(
    input: HarnessPolicyInput,
    requestApproval?: HarnessPolicyApprovalResolver,
  ): Promise<{ allowed: boolean; decision: HarnessPolicyDecision }> {
    const decision = this.classify(input);
    if (decision.action === "allow") {
      return { allowed: true, decision };
    }
    if (decision.action === "deny") {
      return { allowed: false, decision };
    }
    if (!requestApproval) {
      return { allowed: false, decision };
    }
    const approved = await requestApproval({
      toolName: input.toolName,
      permission: decision.permission,
      reason: decision.reason,
    });
    return { allowed: approved, decision };
  }

  private matchesRule(rule: HarnessPolicyRule, input: HarnessPolicyInput): boolean {
    if (!this.matchesTool(rule.tool, input.toolName)) {
      return false;
    }
    if (!this.matchesMode(rule.mode, input.mode)) {
      return false;
    }
    if (!this.matchesSubagent(rule.subagent, input.subagent)) {
      return false;
    }
    if (rule.when?.bashPrefixes && !this.matchesBashPrefixes(input.args, rule.when.bashPrefixes)) {
      return false;
    }
    if (rule.when?.argsPattern && !this.matchesArgsPattern(rule.when.argsPattern, input.args)) {
      return false;
    }
    return true;
  }

  private matchesTool(pattern: string | string[], toolName: string): boolean {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    return patterns.some((entry) => this.matchesWildcard(entry, toolName));
  }

  private matchesMode(ruleMode: HarnessPolicyRule["mode"], inputMode: HarnessPolicyInput["mode"]): boolean {
    if (!ruleMode || ruleMode === "any") return true;
    return inputMode === ruleMode;
  }

  private matchesSubagent(
    ruleSubagent: HarnessPolicyRule["subagent"],
    inputSubagent: HarnessPolicyInput["subagent"],
  ): boolean {
    if (ruleSubagent === undefined || ruleSubagent === "any") return true;
    return Boolean(inputSubagent) === ruleSubagent;
  }

  private matchesBashPrefixes(args: unknown, prefixes: string[]): boolean {
    const command = this.commandPattern(args);
    if (!command) return false;
    return prefixes.some((prefix) => command.startsWith(prefix));
  }

  private matchesArgsPattern(pattern: unknown, args: unknown): boolean {
    return this.deepMatch(pattern, args);
  }

  private deepMatch(pattern: unknown, value: unknown): boolean {
    if (typeof pattern === "string" && pattern.startsWith("re:")) {
      if (typeof value !== "string") return false;
      const regex = new RegExp(pattern.slice(3));
      return regex.test(value);
    }
    if (pattern === null || typeof pattern !== "object") {
      return Object.is(pattern, value);
    }
    if (Array.isArray(pattern)) {
      if (!Array.isArray(value)) return false;
      if (pattern.length !== value.length) return false;
      return pattern.every((entry, index) => this.deepMatch(entry, value[index]));
    }
    if (!value || typeof value !== "object") return false;
    for (const [key, expected] of Object.entries(pattern as Record<string, unknown>)) {
      const actual = (value as Record<string, unknown>)[key];
      if (!this.deepMatch(expected, actual)) {
        return false;
      }
    }
    return true;
  }

  private matchesWildcard(pattern: string, value: string): boolean {
    if (pattern === "*") return true;
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
    return regex.test(value);
  }

  private commandPattern(args: unknown): string {
    if (!args || typeof args !== "object") return "";
    const command = (args as { command?: unknown }).command;
    if (typeof command !== "string") return "";
    return command.trim();
  }
}
