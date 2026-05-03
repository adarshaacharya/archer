import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ComposerSubmission } from "@xeq/shared";

const MAX_MENTIONED_FILES = 4;
const MAX_FILE_CHARS = 8_000;
const MAX_TOTAL_CHARS = 24_000;

export type ExplicitFileContext = {
  hasFileMentions: boolean;
  referencedPaths: string[];
  promptPrefix: string | null;
};

function isWithinRepoRoot(repoRoot: string, absolutePath: string): boolean {
  const rel = relative(repoRoot, absolutePath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function normalizeDisplayedPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function sliceLines(content: string, lineStart?: number, lineEnd?: number): string {
  if (!lineStart && !lineEnd) {
    return content;
  }

  const lines = content.split("\n");
  const start = Math.max(0, (lineStart ?? 1) - 1);
  const end = Math.min(lines.length, lineEnd ?? lines.length);
  return lines.slice(start, end).join("\n");
}

function trimContent(content: string, remainingBudget: number): { text: string; truncated: boolean } {
  const limit = Math.max(0, Math.min(MAX_FILE_CHARS, remainingBudget));
  if (content.length <= limit) {
    return { text: content, truncated: false };
  }

  return {
    text: `${content.slice(0, limit)}\n... truncated ...`,
    truncated: true,
  };
}

export async function buildExplicitFileContext(
  submission: ComposerSubmission,
  repoRoot: string,
): Promise<ExplicitFileContext> {
  const fileMentions = submission.mentions
    .filter(
      (
        mention,
      ): mention is typeof mention & {
        target: Extract<(typeof mention)["target"], { type: "file" }>;
      } => mention.target.type === "file",
    )
    .slice(0, MAX_MENTIONED_FILES);

  if (fileMentions.length === 0) {
    return {
      hasFileMentions: false,
      referencedPaths: [],
      promptPrefix: null,
    };
  }

  const referencedPaths: string[] = [];
  const sections: string[] = [];
  let remainingBudget = MAX_TOTAL_CHARS;

  for (const mention of fileMentions) {
    const target = mention.target;
    const absolutePath = resolve(repoRoot, target.path);
    const displayPath = normalizeDisplayedPath(target.path);
    referencedPaths.push(displayPath);

    if (!isWithinRepoRoot(repoRoot, absolutePath)) {
      sections.push(`File: ${displayPath}\nStatus: skipped because it resolves outside the repository root.`);
      continue;
    }

    try {
      const rawContent = await readFile(absolutePath, "utf8");
      const selectedContent = sliceLines(rawContent, target.lineStart, target.lineEnd);
      const { text, truncated } = trimContent(selectedContent, remainingBudget);
      remainingBudget = Math.max(0, remainingBudget - text.length);
      const rangeSuffix =
        target.lineStart || target.lineEnd
          ? `#L${target.lineStart ?? 1}-${target.lineEnd ?? "end"}`
          : "";
      sections.push(
        [
          `File: ${displayPath}${rangeSuffix}`,
          "Content:",
          text || "(empty file)",
          truncated ? "Note: content truncated to fit the explicit context budget." : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unable to read file";
      sections.push(`File: ${displayPath}\nStatus: ${message}`);
    }

    if (remainingBudget <= 0) {
      sections.push("Note: additional mentioned file content was omitted after reaching the explicit context budget.");
      break;
    }
  }

  return {
    hasFileMentions: true,
    referencedPaths,
    promptPrefix: [
      "Explicit user-mentioned files:",
      ...referencedPaths.map((path) => `- ${path}`),
      "",
      "Use these files as primary starting context before broader repository exploration.",
      ...sections.flatMap((section) => ["", section]),
      "",
    ].join("\n"),
  };
}

export function prependExplicitFileContext(
  prompt: string,
  explicitContext: ExplicitFileContext,
): string {
  if (!explicitContext.promptPrefix) {
    return prompt;
  }

  return `${explicitContext.promptPrefix}${prompt}`;
}
