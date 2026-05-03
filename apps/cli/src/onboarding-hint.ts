import { existsSync } from "node:fs";
import { join } from "node:path";

const hintedRepos = new Set<string>();

export function shouldShowInitHint(projectRoot: string): boolean {
  if (hintedRepos.has(projectRoot)) {
    return false;
  }

  if (existsSync(join(projectRoot, "AGENTS.md"))) {
    return false;
  }

  hintedRepos.add(projectRoot);
  return true;
}

export function renderInitHintMessage(): string {
  return "Tip: run /init to create AGENTS.md and .agents/skills/ for this repo.";
}
