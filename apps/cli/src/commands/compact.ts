import type { SlashCommandItem } from "@xeq/tui";

export const compactSlashCommandItem: SlashCommandItem = {
  name: "/compact",
  description: "compact session context into a continuation brief",
};

export function compactWorkflowPrompt(): string {
  return [
    "Compact the current task context for continuation.",
    "Do not edit files and do not run destructive commands.",
    "Inspect the existing conversation/workspace context as needed and produce a concise continuation brief.",
    "Include:",
    "1) current goal",
    "2) key files and state",
    "3) open risks/questions",
    "4) recommended next actions",
  ].join("\n");
}
