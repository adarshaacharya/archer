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
  inverse: "\x1b[7m",
  reset: "\x1b[0m",
};

const theme: SelectListTheme = {
  selectedPrefix: (text) => `${ANSI.bold}${text}${ANSI.reset}`,
  selectedText: (text) => `${ANSI.inverse}${text}${ANSI.reset}`,
  description: (text) => `${ANSI.dim}${text}${ANSI.reset}`,
  scrollInfo: (text) => `${ANSI.dim}${text}${ANSI.reset}`,
  noMatch: (text) => `${ANSI.dim}${text}${ANSI.reset}`,
};

export type ApprovalDialogChoice = SelectItem;

function boxedLines(title: string, lines: string[], width: number): string[] {
  const safeWidth = Math.max(12, width);
  const innerWidth = Math.max(1, safeWidth - 4);
  const titleChunk = ` ${title.trim()} `;
  const topBorder = `┌${titleChunk}${"─".repeat(Math.max(1, innerWidth - titleChunk.length + 2))}┐`;
  const bottomBorder = `└${"─".repeat(safeWidth - 2)}┘`;

  return [
    topBorder,
    ...lines.flatMap((line) => {
      const wrapped = wrapTextWithAnsi(line, innerWidth);
      if (wrapped.length === 0) {
        return [`│ ${" ".repeat(innerWidth)} │`];
      }
      return wrapped.map((part) => {
        const visible = truncateToWidth(part, innerWidth);
        return `│ ${visible}${" ".repeat(Math.max(0, innerWidth - visible.length))} │`;
      });
    }),
    bottomBorder,
  ];
}

export class ApprovalDialog implements Component {
  private readonly selectList: SelectList;
  private message: string;
  onSelect?: (value: string) => void;
  onCancel?: () => void;

  constructor(message: string, choices: ApprovalDialogChoice[]) {
    this.message = message;
    this.selectList = new SelectList(choices, 5, theme, {
      minPrimaryColumnWidth: 20,
      maxPrimaryColumnWidth: 28,
    });
  }

  invalidate(): void {
    this.selectList.invalidate();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const promptLines = wrapTextWithAnsi(this.message, safeWidth);
    const listLines = this.selectList.render(safeWidth - 4);

    return [
      ...boxedLines("Approval", [...promptLines, "", ...listLines], safeWidth),
      "",
      ...wrapTextWithAnsi("↑/↓ move  enter select  esc reject", safeWidth),
    ];
  }

  handleInput(data: string): void {
    const normalized = data.trim().toLowerCase();
    if (normalized === "y" || normalized === "yes" || normalized === "once") {
      this.onSelect?.("once");
      return;
    }
    if (normalized === "a" || normalized === "always") {
      this.onSelect?.("always");
      return;
    }
    if (normalized === "n" || normalized === "no" || normalized === "reject") {
      this.onSelect?.("reject");
      return;
    }

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onCancel?.();
      return;
    }

    this.selectList.handleInput(data);
    const selected = this.selectList.getSelectedItem();
    if (selected && matchesKey(data, Key.enter)) {
      this.onSelect?.(selected.value);
    }
  }
}
