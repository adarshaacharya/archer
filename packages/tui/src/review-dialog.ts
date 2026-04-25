import {
  type Component,
  Key,
  type SelectItem,
  SelectList,
  type SelectListTheme,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";

const ANSI = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  inverse: "\x1b[7m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
};

const theme: SelectListTheme = {
  selectedPrefix: (text) => `${ANSI.bold}${text}${ANSI.reset}`,
  selectedText: (text) => `${ANSI.inverse}${text}${ANSI.reset}`,
  description: (text) => `${ANSI.dim}${text}${ANSI.reset}`,
  scrollInfo: (text) => `${ANSI.dim}${text}${ANSI.reset}`,
  noMatch: (text) => `${ANSI.dim}${text}${ANSI.reset}`,
};

export type PatchReviewFile = {
  filePath: string;
  diff: string;
  status?: string;
};

export type PatchReviewState = {
  summary: string;
  changedFilesCount: number;
  files: PatchReviewFile[];
};

export type ReviewChoice = SelectItem;

type FocusArea = "files" | "actions";

function compactDiff(diff: string, width: number, maxLines = 18): string[] {
  const output: string[] = [];
  const lines = diff.split("\n");
  let inHunk = false;

  for (const rawLine of lines) {
    if (rawLine.startsWith("@@")) {
      inHunk = true;
      output.push(`${ANSI.cyan}${rawLine}${ANSI.reset}`);
      continue;
    }

    if (rawLine.startsWith("--- ") || rawLine.startsWith("+++ ")) {
      output.push(`${ANSI.dim}${rawLine}${ANSI.reset}`);
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (rawLine.startsWith("+") || rawLine.startsWith("-")) {
      output.push(
        rawLine.startsWith("+")
          ? `${ANSI.green}${rawLine}${ANSI.reset}`
          : `${ANSI.red}${rawLine}${ANSI.reset}`,
      );
      continue;
    }

    if (rawLine.startsWith(" ")) {
      output.push(`${ANSI.dim}${rawLine}${ANSI.reset}`);
    }
  }

  const visible = output.flatMap((line) => wrapTextWithAnsi(line, width));
  if (visible.length === 0) {
    return ["(no diff)"];
  }

  return visible.length > maxLines
    ? [...visible.slice(0, maxLines - 1), "... truncated ..."]
    : visible;
}

function boxedSection(title: string, lines: string[], width: number): string[] {
  const safeWidth = Math.max(12, width);
  const innerWidth = Math.max(1, safeWidth - 4);
  const titleText = title.trim();
  const titleChunk = titleText.length > 0 ? ` ${titleText} ` : " ";
  const topBorder = `┌${titleChunk}${"─".repeat(Math.max(1, innerWidth - titleChunk.length + 2))}┐`;
  const bottomBorder = `└${"─".repeat(safeWidth - 2)}┘`;

  const body = lines.length > 0 ? lines : ["(empty)"];
  return [
    topBorder,
    ...body.flatMap((line) => {
      const wrapped = wrapTextWithAnsi(line, innerWidth);
      if (wrapped.length === 0) {
        return [`│ ${" ".repeat(innerWidth)} │`];
      }
      return wrapped.map((part) => {
        const visible = truncateToWidth(part, innerWidth);
        const pad = Math.max(0, innerWidth - visible.length);
        return `│ ${visible}${" ".repeat(pad)} │`;
      });
    }),
    bottomBorder,
  ];
}

export class PatchReviewDialog implements Component {
  private readonly fileList: SelectList;
  private readonly actionList: SelectList;
  private focus: FocusArea = "files";
  private readonly title: string;
  private readonly subtitle: string | null;
  private readonly question: string;
  private readonly review: PatchReviewState;
  onSelect?: (value: string) => void;
  onCancel?: () => void;

  constructor(
    title: string,
    subtitle: string | undefined,
    review: PatchReviewState,
    actions: ReviewChoice[],
  ) {
    this.title = title;
    this.subtitle = subtitle?.trim() ? subtitle.trim() : null;
    this.question = "Do you want to apply these changes?";
    this.review = review;
    this.fileList = new SelectList(
      review.files.map((file) => ({
        value: file.filePath,
        label: file.filePath,
        description: file.status ?? "prepared",
      })),
      4,
      theme,
      {
        minPrimaryColumnWidth: 24,
        maxPrimaryColumnWidth: 42,
      },
    );
    this.actionList = new SelectList(actions, 3, theme, {
      minPrimaryColumnWidth: 18,
      maxPrimaryColumnWidth: 24,
    });
  }

  invalidate(): void {
    this.fileList.invalidate();
    this.actionList.invalidate();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const file = this.getSelectedFile();
    const title = wrapTextWithAnsi(`${ANSI.bold}${this.title}${ANSI.reset}`, safeWidth);
    const subtitle = this.subtitle
      ? wrapTextWithAnsi(`${ANSI.dim}${this.subtitle}${ANSI.reset}`, safeWidth)
      : [];
    const question = wrapTextWithAnsi(`${ANSI.bold}${this.question}${ANSI.reset}`, safeWidth);
    const hint = wrapTextWithAnsi(
      `${ANSI.dim}tab switch focus  enter choose  esc reject${ANSI.reset}`,
      safeWidth,
    );
    const fileListTitle = this.focus === "files" ? "> Files" : "Files";
    const actionListTitle = this.focus === "actions" ? "> Actions" : "Actions";
    const diffLines = file ? compactDiff(file.diff, safeWidth - 4, 14) : ["(no file selected)"];
    const fileLabel = truncateToWidth(file ? file.filePath : "no file selected", safeWidth - 4);
    const previewSection = boxedSection(
      `Preview ${fileLabel}`,
      [
        `${ANSI.dim}+ added${ANSI.reset}   ${ANSI.dim}- removed${ANSI.reset}   ${ANSI.dim}@@ hunk${ANSI.reset}`,
        "",
        ...diffLines,
      ],
      safeWidth,
    );

    return [
      ...title,
      ...subtitle,
      ...wrapTextWithAnsi(
        `${ANSI.dim}${this.review.changedFilesCount} changed file${
          this.review.changedFilesCount === 1 ? "" : "s"
        }${ANSI.reset}`,
        safeWidth,
      ),
      "",
      ...question,
      "",
      ...boxedSection(fileListTitle, this.fileList.render(safeWidth - 4), safeWidth),
      "",
      ...previewSection,
      "",
      ...boxedSection(actionListTitle, this.actionList.render(safeWidth - 4), safeWidth),
      "",
      ...hint,
    ];
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onCancel?.();
      return;
    }

    if (matchesKey(data, Key.tab)) {
      this.focus = this.focus === "files" ? "actions" : "files";
      return;
    }

    if (this.focus === "files") {
      this.fileList.handleInput(data);
      if (matchesKey(data, Key.enter)) {
        this.focus = "actions";
      }
      return;
    }

    const selectedBefore = this.actionList.getSelectedItem();
    this.actionList.handleInput(data);
    const selectedAfter = this.actionList.getSelectedItem();
    if (selectedAfter && matchesKey(data, Key.enter)) {
      this.onSelect?.(selectedAfter.value);
      return;
    }

    if (!selectedBefore && selectedAfter) {
      this.onSelect?.(selectedAfter.value);
    }
  }

  private getSelectedFile(): PatchReviewFile | null {
    const selected = this.fileList.getSelectedItem();
    if (!selected) return null;
    return this.review.files.find((file) => file.filePath === selected.value) ?? null;
  }
}
