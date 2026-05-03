const DEFAULT_HISTORY_LIMIT = 100;

export class PromptHistory {
  private readonly entries: string[] = [];
  private draft = "";
  private cursor: number | null = null;

  constructor(private readonly limit: number = DEFAULT_HISTORY_LIMIT) {}

  record(submit: string): void {
    const value = submit.trim();
    this.cursor = null;
    this.draft = "";

    if (!value) {
      return;
    }

    this.entries.push(value);
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
  }

  syncDraft(value: string): void {
    if (this.cursor === null) {
      this.draft = value;
    }
  }

  previous(current: string): string | null {
    if (this.entries.length === 0) {
      return null;
    }

    if (this.cursor === null) {
      this.draft = current;
      this.cursor = this.entries.length - 1;
      return this.entries[this.cursor] ?? null;
    }

    this.cursor = Math.max(0, this.cursor - 1);
    return this.entries[this.cursor] ?? null;
  }

  next(): string | null {
    if (this.cursor === null) {
      return null;
    }

    if (this.cursor < this.entries.length - 1) {
      this.cursor += 1;
      return this.entries[this.cursor] ?? null;
    }

    this.cursor = null;
    return this.draft;
  }

  clearNavigation(): void {
    this.cursor = null;
  }

  isNavigating(): boolean {
    return this.cursor !== null;
  }
}
