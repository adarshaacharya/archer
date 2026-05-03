import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ComposerMentionBinding, ComposerSubmission } from "@xeq/shared";

const MAX_MENTIONED_FILES = 4;
const MAX_FILE_CHARS = 8_000;
const MAX_TOTAL_CHARS = 24_000;
const PATH_MENTION_PATTERN =
  /(^|[\s(])@((?:\.{1,2}\/)?(?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+)(?:#L(\d+)(?:-(\d+|end))?)?(?=$|[\s),.:;!?])/g;

export type ExplicitFileContext = {
  hasFileMentions: boolean;
  referencedPaths: string[];
  promptPrefix: string | null;
};

type FileMentionBinding = ComposerMentionBinding & {
  target: Extract<ComposerMentionBinding["target"], { type: "file" }>;
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

function parseFallbackFileMentions(text: string): FileMentionBinding[] {
  const bindings: FileMentionBinding[] = [];

  for (const match of text.matchAll(PATH_MENTION_PATTERN)) {
    const matchedPath = match[2];
    if (!matchedPath) {
      continue;
    }

    const wholeMatch = match[0];
    const leading = match[1] ?? "";
    const pathStart = (match.index ?? 0) + leading.length;
    const label = wholeMatch.slice(leading.length);
    const lineStartRaw = match[3];
    const lineEndRaw = match[4];

    bindings.push({
      id: `fallback_${pathStart}_${matchedPath}`,
      label,
      start: pathStart,
      end: pathStart + label.length,
      target: {
        type: "file",
        path: normalizeDisplayedPath(matchedPath),
        lineStart: lineStartRaw ? Number.parseInt(lineStartRaw, 10) : undefined,
        lineEnd:
          lineEndRaw && lineEndRaw !== "end" ? Number.parseInt(lineEndRaw, 10) : undefined,
      },
    });
  }

  return bindings;
}

function collectFileMentions(submission: ComposerSubmission): FileMentionBinding[] {
  const structured = submission.mentions.filter(
    (
      mention,
    ): mention is FileMentionBinding => mention.target.type === "file",
  );
  const structuredPaths = new Set(structured.map((mention) => mention.target.path));
  const seen = new Set(
    structured.map((mention) =>
      `${mention.target.path}:${mention.target.lineStart ?? ""}:${mention.target.lineEnd ?? ""}`,
    ),
  );
  const fallback = parseFallbackFileMentions(submission.text).filter((mention) => {
    if (structuredPaths.has(mention.target.path)) {
      return false;
    }
    const key = `${mention.target.path}:${mention.target.lineStart ?? ""}:${mention.target.lineEnd ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return [...structured, ...fallback].slice(0, MAX_MENTIONED_FILES);
}

export async function buildExplicitFileContext(
  submission: ComposerSubmission,
  repoRoot: string,
): Promise<ExplicitFileContext> {
  const fileMentions = collectFileMentions(submission);

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
