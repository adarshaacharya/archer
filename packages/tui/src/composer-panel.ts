import {
  type Component,
  type Focusable,
  Input,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";

const ANSI = {
  reset: "\x1b[0m",
};

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

export class ComposerPanel implements Component, Focusable {
  readonly input: Input;
  private _focused = false;
  private statusText = "";
  private slashMenuText = "";
  private hintsText = "";

  constructor() {
    this.input = new Input();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  setStatus(text: string): void {
    this.statusText = text.trim();
  }

  setSlashMenu(text: string): void {
    this.slashMenuText = text.trim();
  }

  setHints(text: string): void {
    this.hintsText = text.trim();
  }

  invalidate(): void {}

  handleInput(data: string): void {
    this.input.handleInput(data);
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const innerWidth = Math.max(1, safeWidth - 4);
    const inputLine = this.input.render(innerWidth)[0] ?? "> ";

    // Content that lives inside the box: just the input + hints
    const boxContent: string[] = [inputLine];
    if (this.hintsText) {
      boxContent.push("", `${ANSI.reset}${this.hintsText}${ANSI.reset}`);
    }

    // Status renders above the box; slash menu renders below
    const above: string[] = [];
    if (this.statusText) {
      above.push(...wrapTextWithAnsi(this.statusText, safeWidth), "");
    }

    const below: string[] = [];
    if (this.slashMenuText) {
      below.push("", ...wrapTextWithAnsi(this.slashMenuText, safeWidth));
    }

    return [...above, ...boxedLines("XEQ", boxContent, safeWidth), ...below];
  }
}
