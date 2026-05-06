import { access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SlashCommandItem } from "@archer/tui";

export const initSlashCommandItem: SlashCommandItem = {
  name: "/init",
  description: "bootstrap AGENTS.md and .agents/skills/",
};

export type BootstrapResult = {
  created: string[];
  skipped: string[];
};

const DEFAULT_AGENTS_MD = [
  "# AGENTS.md",
  "",
  "## Project Overview",
  "",
  "Describe the project, the main goals, and any implementation constraints here.",
  "",
  "## Repo Guidance",
  "",
  "- Keep instructions short and actionable.",
  "- Add repo-specific conventions, test commands, and safety rules.",
  "- Keep skills in `.agents/skills/`.",
  "",
  "## Notes for Agents",
  "",
  "- Read this file before making broad changes.",
  "- Prefer repo-local guidance over generic assumptions.",
  "",
].join("\n");

export async function bootstrapWorkspace(cwd: string): Promise<BootstrapResult> {
  const created: string[] = [];
  const skipped: string[] = [];

  await ensureDir(join(cwd, ".agents"));
  await ensureDir(join(cwd, ".agents/skills"));

  await writeIfMissing(join(cwd, "AGENTS.md"), DEFAULT_AGENTS_MD, created, skipped);

  return { created, skipped };
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function writeIfMissing(
  path: string,
  content: string,
  created: string[],
  skipped: string[],
): Promise<void> {
  if (await exists(path)) {
    skipped.push(path);
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
  created.push(path);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
