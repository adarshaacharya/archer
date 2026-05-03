export type CommandRisk = "allow" | "ask" | "deny";

export type ShellAnalysis =
  | {
      kind: "simple";
      command: string;
      argv: string[];
      risk: CommandRisk;
      reasons: string[];
    }
  | {
      kind: "compound";
      command: string;
      segments: Array<{
        command: string;
        argv: string[];
        risk: CommandRisk;
        reasons: string[];
      }>;
      risk: CommandRisk;
      reasons: string[];
    }
  | {
      kind: "too-complex";
      command: string;
      risk: "ask";
      reasons: string[];
    };

const DANGEROUS_EXACT_PATTERNS: RegExp[] = [
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

const NETWORK_COMMANDS = new Set(["curl", "wget", "ssh", "scp", "sftp", "ftp", "nc", "netcat"]);

const SAFE_COMMAND_PATTERNS: RegExp[] = [
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

const MUTATING_GIT_COMMANDS = new Set([
  "push",
  "commit",
  "merge",
  "rebase",
  "fetch",
  "pull",
  "cherry-pick",
]);
const MUTATING_PACKAGE_ACTIONS = new Set([
  "install",
  "add",
  "update",
  "upgrade",
  "remove",
  "uninstall",
  "publish",
]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

const COMPLEX_SHELL_TOKENS = ["$(", "`", ">", "<", "*", "?", "{", "}", "[", "]"];
const SEGMENT_SEPARATORS = ["&&", "||", ";", "|"];

function maxRisk(a: CommandRisk, b: CommandRisk): CommandRisk {
  if (a === "deny" || b === "deny") return "deny";
  if (a === "ask" || b === "ask") return "ask";
  return "allow";
}

function containsUnquotedToken(input: string, token: string): boolean {
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (typeof char !== "string") {
      continue;
    }
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (input.startsWith(token, index)) {
      return true;
    }
  }

  return false;
}

function splitCommandSegments(command: string): string[] | null {
  const segments: string[] = [];
  let quote: "'" | '"' | null = null;
  let escaping = false;
  let start = 0;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (typeof char !== "string") {
      continue;
    }
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    const twoChar = command.slice(index, index + 2);
    if (twoChar === "&&" || twoChar === "||") {
      const segment = command.slice(start, index).trim();
      if (!segment) {
        return null;
      }
      segments.push(segment);
      start = index + 2;
      index += 1;
      continue;
    }

    if (char === ";" || char === "|") {
      const segment = command.slice(start, index).trim();
      if (!segment) {
        return null;
      }
      segments.push(segment);
      start = index + 1;
    }
  }

  if (quote || escaping) {
    return null;
  }

  const tail = command.slice(start).trim();
  if (!tail) {
    return segments.length === 0 ? null : segments;
  }
  segments.push(tail);
  return segments;
}

function parseSimpleArgv(command: string): string[] | null {
  const argv: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of command) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char.trim() === "") {
      if (current) {
        argv.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote || escaping) {
    return null;
  }

  if (current) {
    argv.push(current);
  }

  return argv.length > 0 ? argv : null;
}

function classifySimpleCommand(command: string): {
  argv: string[];
  risk: CommandRisk;
  reasons: string[];
} | null {
  const argv = parseSimpleArgv(command);
  if (!argv) {
    return null;
  }

  const reasons: string[] = [];
  let risk: CommandRisk = "ask";

  for (const pattern of DANGEROUS_EXACT_PATTERNS) {
    if (pattern.test(command)) {
      reasons.push("dangerous command pattern");
      return { argv, risk: "deny", reasons };
    }
  }

  for (const token of COMPLEX_SHELL_TOKENS) {
    if (containsUnquotedToken(command, token)) {
      reasons.push(`complex shell token: ${token}`);
      return null;
    }
  }

  if (SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) {
    reasons.push("safe command allowlist");
    return { argv, risk: "allow", reasons };
  }

  if (argv.length === 0) {
    return null;
  }
  const program = argv[0];
  if (typeof program !== "string" || program.length === 0) {
    return null;
  }
  const firstArg = argv[1];
  const programLower = program.toLowerCase();
  const firstArgLower = firstArg?.toLowerCase();

  if (NETWORK_COMMANDS.has(programLower)) {
    reasons.push("network command");
    risk = maxRisk(risk, "ask");
  }

  if (programLower === "git" && firstArgLower && MUTATING_GIT_COMMANDS.has(firstArgLower)) {
    reasons.push("mutating git command");
    risk = maxRisk(risk, "ask");
  }

  if (
    PACKAGE_MANAGERS.has(programLower) &&
    firstArgLower &&
    MUTATING_PACKAGE_ACTIONS.has(firstArgLower)
  ) {
    reasons.push("package manager mutation");
    risk = maxRisk(risk, "ask");
  }

  if (reasons.length === 0) {
    reasons.push("unclassified command");
  }

  return { argv, risk, reasons };
}

export function analyzeShellCommand(command: string): ShellAnalysis {
  const normalized = command.trim();
  if (!normalized) {
    return {
      kind: "too-complex",
      command,
      risk: "ask",
      reasons: ["empty command"],
    };
  }

  if (SEGMENT_SEPARATORS.some((token) => containsUnquotedToken(normalized, token))) {
    const segments = splitCommandSegments(normalized);
    if (!segments) {
      return {
        kind: "too-complex",
        command,
        risk: "ask",
        reasons: ["failed to segment command safely"],
      };
    }

    const classifiedSegments = [];
    let risk: CommandRisk = "allow";
    for (const segment of segments) {
      const classified = classifySimpleCommand(segment);
      if (!classified) {
        return {
          kind: "too-complex",
          command,
          risk: "ask",
          reasons: [`segment too complex: ${segment}`],
        };
      }
      risk = maxRisk(risk, classified.risk);
      classifiedSegments.push({
        command: segment,
        argv: classified.argv,
        risk: classified.risk,
        reasons: classified.reasons,
      });
    }

    return {
      kind: "compound",
      command,
      segments: classifiedSegments,
      risk,
      reasons: ["segmented shell command"],
    };
  }

  const classified = classifySimpleCommand(normalized);
  if (!classified) {
    return {
      kind: "too-complex",
      command,
      risk: "ask",
      reasons: ["command is too complex for trusted parsing"],
    };
  }

  return {
    kind: "simple",
    command,
    argv: classified.argv,
    risk: classified.risk,
    reasons: classified.reasons,
  };
}
