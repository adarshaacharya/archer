import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { ComposerMentionBinding, ComposerTextElement } from "@archer/shared";

const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

export type MentionSuggestion = {
  label: string;
  path: string;
};

export type ActiveMentionQuery = {
  query: string;
  replaceStart: number;
  replaceEnd: number;
};

export type MentionInsertResult = {
  text: string;
  mentions: ComposerMentionBinding[];
  cursorOffset: number;
};

function normalizePathForDisplay(path: string): string {
  return path.replaceAll("\\", "/");
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(left: string, right: string, prefixLength: number): number {
  const max = Math.min(left.length, right.length) - prefixLength;
  let suffix = 0;
  while (suffix < max && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) {
    suffix += 1;
  }
  return suffix;
}

function scoreSuggestion(path: string, query: string): number {
  if (!query) {
    return 1000 - path.length;
  }

  const lowerPath = path.toLowerCase();
  const lowerBase = basename(path).toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (lowerPath === lowerQuery || lowerBase === lowerQuery) return 10_000;
  if (lowerBase.startsWith(lowerQuery)) return 8_000 - lowerBase.length;
  if (lowerPath.startsWith(lowerQuery)) return 7_000 - lowerPath.length;

  const basenameIndex = lowerBase.indexOf(lowerQuery);
  if (basenameIndex >= 0) return 6_000 - basenameIndex;

  const pathIndex = lowerPath.indexOf(lowerQuery);
  if (pathIndex >= 0) return 5_000 - pathIndex;

  return Number.NEGATIVE_INFINITY;
}

async function walkFiles(root: string, directory: string, output: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      await walkFiles(root, join(directory, entry.name), output);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    output.push(normalizePathForDisplay(relative(root, join(directory, entry.name))));
  }
}

export function findActiveMentionQuery(
  text: string,
  cursorOffset: number,
): ActiveMentionQuery | null {
  const safeCursorOffset = Math.max(0, Math.min(cursorOffset, text.length));
  const beforeCursor = text.slice(0, safeCursorOffset);
  const tokenStart = Math.max(beforeCursor.lastIndexOf(" "), beforeCursor.lastIndexOf("\n")) + 1;
  const token = beforeCursor.slice(tokenStart);
  if (!token.startsWith("@")) {
    return null;
  }

  const mentionBody = token.slice(1);
  if (mentionBody.includes("@") || /\s/.test(mentionBody)) {
    return null;
  }

  return {
    query: mentionBody,
    replaceStart: tokenStart,
    replaceEnd: safeCursorOffset,
  };
}

export function reconcileMentionBindings(
  previousText: string,
  nextText: string,
  bindings: ComposerMentionBinding[],
): ComposerMentionBinding[] {
  if (bindings.length === 0 || previousText === nextText) {
    return bindings;
  }

  const prefixLength = commonPrefixLength(previousText, nextText);
  const suffixLength = commonSuffixLength(previousText, nextText, prefixLength);
  const oldChangedEnd = previousText.length - suffixLength;
  const delta = nextText.length - previousText.length;

  return bindings
    .flatMap((binding) => {
      if (binding.end <= prefixLength) {
        return [binding];
      }

      if (binding.start >= oldChangedEnd) {
        return [
          {
            ...binding,
            start: binding.start + delta,
            end: binding.end + delta,
          },
        ];
      }

      return [];
    })
    .filter((binding) => nextText.slice(binding.start, binding.end) === binding.label);
}

export function insertFileMention(
  text: string,
  context: ActiveMentionQuery,
  bindings: ComposerMentionBinding[],
  filePath: string,
): MentionInsertResult {
  const label = `@${normalizePathForDisplay(filePath)}`;
  const replacement = `${label} `;
  const nextText = `${text.slice(0, context.replaceStart)}${replacement}${text.slice(context.replaceEnd)}`;
  const shift = replacement.length - (context.replaceEnd - context.replaceStart);
  const nextBindings = bindings
    .filter((binding) => binding.end <= context.replaceStart || binding.start >= context.replaceEnd)
    .map((binding) => {
      if (binding.start >= context.replaceEnd) {
        return {
          ...binding,
          start: binding.start + shift,
          end: binding.end + shift,
        };
      }
      return binding;
    });

  const start = context.replaceStart;
  const end = start + label.length;
  nextBindings.push({
    id: randomUUID(),
    label,
    start,
    end,
    target: {
      type: "file",
      path: normalizePathForDisplay(filePath),
    },
  });
  nextBindings.sort((left, right) => left.start - right.start);

  return {
    text: nextText,
    mentions: nextBindings,
    cursorOffset: start + replacement.length,
  };
}

export function buildComposerTextElements(
  bindings: ComposerMentionBinding[],
): ComposerTextElement[] {
  return bindings
    .slice()
    .sort((left, right) => left.start - right.start)
    .map((binding) => ({
      start: binding.start,
      end: binding.end,
      kind: "mention" as const,
      display: binding.label,
      bindingId: binding.id,
    }));
}

export class MentionFileIndex {
  private filesPromise: Promise<string[]> | null = null;

  constructor(private readonly root: string) {}

  async search(query: string, limit = 8): Promise<MentionSuggestion[]> {
    const files = await this.getFiles();
    const scored = files
      .map((path) => ({ path, score: scoreSuggestion(path, query) }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, limit);

    return scored.map((entry) => ({
      label: `@${entry.path}`,
      path: entry.path,
    }));
  }

  private async getFiles(): Promise<string[]> {
    if (!this.filesPromise) {
      this.filesPromise = (async () => {
        const files: string[] = [];
        await walkFiles(this.root, this.root, files);
        files.sort((left, right) => left.localeCompare(right));
        return files;
      })();
    }

    return this.filesPromise;
  }
}
