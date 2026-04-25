const ANSI_RE = /\x1b\[[0-9;]*m/g;

function visibleLen(s: string): number {
  return s.replace(ANSI_RE, "").length;
}

const A = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};

export function buildWelcomePanel(terminalCols: number): string {
  // Row format: │ [leftInner] │ [rightInner] │
  // Total = 2 + leftInner + 3 + rightInner + 2 = leftInner + rightInner + 7
  const W = Math.max(64, Math.min(terminalCols - 2, 120));
  const leftInner = Math.floor((W - 7) * 0.42);
  const rightInner = W - 7 - leftInner;

  const rawCwd = process.cwd().replace(process.env["HOME"] ?? "", "~");
  const cwd = visibleLen(rawCwd) > leftInner ? `…${rawCwd.slice(-(leftInner - 1))}` : rawCwd;

  function pad(text: string, maxLen: number): string {
    const vlen = visibleLen(text);
    if (vlen <= maxLen) {
      return text + " ".repeat(maxLen - vlen);
    }
    const raw = text.replace(ANSI_RE, "");
    return `${raw.slice(0, maxLen - 1)}…`;
  }

  function row(left: string, right: string): string {
    return `│ ${pad(left, leftInner)} │ ${pad(right, rightInner)} │`;
  }

  const titleStr = " XEQ ";
  const topBorder =
    "┌" +
    titleStr +
    "─".repeat(Math.max(0, leftInner + 2 - titleStr.length)) +
    "┬" +
    "─".repeat(rightInner + 2) +
    "┐";
  const botBorder =
    "└" +
    "─".repeat(leftInner + 2) +
    "┴" +
    "─".repeat(rightInner + 2) +
    "┘";
  const sep = `${A.dim}${"─".repeat(rightInner)}${A.reset}`;

  const lines = [
    topBorder,
    row("", ""),
    row(`${A.bold}Welcome to XEQ${A.reset}`, `${A.bold}${A.yellow}Getting started${A.reset}`),
    row(`${A.dim}AI coding agent${A.reset}`, sep),
    row("", "Describe a task in plain English. XEQ"),
    row(`${A.dim}${cwd}${A.reset}`, "reads files, runs commands, writes code."),
    row("", ""),
    row("", `${A.bold}${A.yellow}Commands${A.reset}`),
    row("", sep),
    row("", `${A.cyan}/connect${A.reset}  ${A.dim}openai · anthropic · gemini · openrouter${A.reset}`),
    row("", `${A.cyan}/web${A.reset}      ${A.dim}tavily · exa${A.reset}`),
    row("", `${A.cyan}/help${A.reset}     ${A.dim}all slash commands${A.reset}`),
    row("", `${A.cyan}/permissions${A.reset}  ${A.dim}saved allow rules${A.reset}`),
    row("", ""),
    row(`${A.dim}Esc=cancel  ·  Ctrl+D=quit${A.reset}`, ""),
    row("", ""),
    botBorder,
  ];

  return lines.join("\n");
}
