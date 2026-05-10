type ApprovalDialogChoice = {
  value: string;
  label: string;
  description?: string;
};

type ApprovalPromptState = {
  message: string;
  options?: string[];
  choices?: ApprovalDialogChoice[];
  selectedIndex?: number;
  details?: string;
};

type SlashCommandItem = {
  name: string;
  description: string;
};

export function normalizeText(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}

export function truncateMiddle(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 3) return value.slice(0, max);
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function padRight(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

export function wrappedLineCount(value: string, width: number): number {
  const safeWidth = Math.max(1, width);
  const lines = value.length === 0 ? [""] : value.split("\n");
  return lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / safeWidth)), 0);
}

export function compactDiff(diff: string, maxLines = 16): string {
  const lines: string[] = [];
  let inHunk = false;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      inHunk = true;
      lines.push(raw);
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) {
      lines.push(raw);
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("+") || raw.startsWith("-") || raw.startsWith(" ")) lines.push(raw);
  }
  if (lines.length <= maxLines) return lines.join("\n").trim() || "(no diff)";
  return `${lines.slice(0, maxLines).join("\n")}\n... truncated ...`;
}

export function defaultApprovalChoices(): ApprovalDialogChoice[] {
  return [
    { value: "reject", label: "Reject", description: "Deny this action" },
    { value: "once", label: "Approve once", description: "Allow this action this time only" },
    { value: "always", label: "Always approve", description: "Remember this rule for next time" },
  ];
}

export function approvalTitle(prompt: ApprovalPromptState): string {
  const message = normalizeText(prompt.message).toLowerCase();
  if (message.includes("choose model")) return "model picker";
  if (message.includes("choose model provider")) return "provider picker";
  if (message.includes("review")) return "review changes";
  return "selection";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function containsUtf8Locale(value: string | undefined): boolean {
  return /utf-?8/i.test(value ?? "");
}

export function shouldUseUnicodeBoxDrawing(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TERM?.trim().toLowerCase() === "dumb") {
    return false;
  }

  if (
    containsUtf8Locale(env.LC_ALL) ||
    containsUtf8Locale(env.LC_CTYPE) ||
    containsUtf8Locale(env.LANG)
  ) {
    return true;
  }

  return false;
}

export function approvalDialogWidth(
  prompt: ApprovalPromptState,
  choices: ApprovalDialogChoice[],
): number {
  const labelWidth = Math.max(...choices.map((choice) => choice.label.length), 0);
  const detailWidth = prompt.details ? normalizeText(prompt.details).length : 0;
  const messageWidth = normalizeText(prompt.message).length;
  return clamp(Math.max(labelWidth + 10, detailWidth + 4, messageWidth + 4), 42, 88);
}

export function slashCommandMatches(
  commands: SlashCommandItem[],
  input: string,
): SlashCommandItem[] {
  const v = input.trim();
  if (!v.startsWith("/")) return [];
  const query = v.slice(1).toLowerCase();
  const matches = commands.filter((c) => c.name.slice(1).toLowerCase().startsWith(query));
  return matches.length > 0 ? matches : commands;
}
