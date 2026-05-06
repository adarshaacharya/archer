import type { SlashCommandItem } from "@archer/tui";

export const commitSlashCommandItem: SlashCommandItem = {
  name: "/commit",
  description: "create a git commit from the current changes",
};

function runGit(cwd: string, args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();
  if (result.exitCode !== 0 && !stdout) {
    return stderr || `git ${args.join(" ")} failed`;
  }

  return stdout || "(no output)";
}

export function commitWorkflowPrompt(cwd: string): string {
  const status = runGit(cwd, ["status", "--short"]);
  const diff = runGit(cwd, ["diff", "HEAD"]);
  const branch = runGit(cwd, ["branch", "--show-current"]);
  const log = runGit(cwd, ["log", "--oneline", "-10"]);

  return [
    "Create a single git commit for the current repository state.",
    "",
    "## Context",
    "",
    "- Current git status:",
    "```",
    status,
    "```",
    "",
    "- Current git diff (staged and unstaged changes):",
    "```diff",
    diff,
    "```",
    "",
    "- Current branch:",
    "```",
    branch,
    "```",
    "",
    "- Recent commits:",
    "```",
    log,
    "```",
    "",
    "## Git Safety Protocol",
    "",
    "- NEVER update the git config",
    "- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it",
    "- CRITICAL: ALWAYS create NEW commits. NEVER use git commit --amend, unless the user explicitly requests it",
    "- Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files",
    "- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit",
    "- Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported",
    "",
    "## Your task",
    "",
    "Based on the above changes, create a single git commit:",
    "",
    "1. Analyze all staged changes and draft a commit message:",
    "   - Look at the recent commits above to follow this repository's commit message style",
    "   - Summarize the nature of the changes (new feature, enhancement, bug fix, refactoring, test, docs, etc.)",
    '   - Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.)',
    '   - Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"',
    "",
    "2. Stage relevant files and create the commit using HEREDOC syntax:",
    "```",
    `git commit -m "$(cat <<'EOF'`,
    "Commit message here.",
    "EOF",
    ')"',
    "```",
    "",
    "You have the capability to call multiple tools in a single response. Stage and create the commit using a single message. Do not use any other tools or do anything else. Do not send any other text or messages besides these tool calls.",
  ].join("\n");
}
