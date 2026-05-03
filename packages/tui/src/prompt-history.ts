import type { ComposerMentionBinding } from "@xeq/shared";

const DEFAULT_HISTORY_LIMIT = 100;

export type PromptHistoryEntry = {
  text: string;
  mentions: ComposerMentionBinding[];
};

function normalizeEntry(entry: PromptHistoryEntry | string): PromptHistoryEntry {
  if (typeof entry === "string") {
    return {
      text: entry,
      mentions: [],
    };
  }

  return {
    text: entry.text,
    mentions: entry.mentions.slice(),
  };
}

export class PromptHistory {
  private readonly entries: PromptHistoryEntry[] = [];
  private draft: PromptHistoryEntry = { text: "", mentions: [] };
  private cursor: number | null = null;

  constructor(private readonly limit: number = DEFAULT_HISTORY_LIMIT) {}

  record(submit: PromptHistoryEntry | string): void {
    const entry = normalizeEntry(submit);
    const value = entry.text.trim();
    this.cursor = null;
    this.draft = { text: "", mentions: [] };

    if (!value) {
      return;
    }

    this.entries.push({
      text: value,
      mentions: entry.mentions.slice(),
    });
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
  }

  syncDraft(value: string, mentions: ComposerMentionBinding[] = []): void {
    if (this.cursor === null) {
      this.draft = {
        text: value,
        mentions: mentions.slice(),
      };
    }
  }

  previous(current: PromptHistoryEntry | string): PromptHistoryEntry | null {
    if (this.entries.length === 0) {
      return null;
    }

    if (this.cursor === null) {
      this.draft = normalizeEntry(current);
      this.cursor = this.entries.length - 1;
      const entry = this.entries[this.cursor];
      return entry ? { text: entry.text, mentions: entry.mentions.slice() } : null;
    }

    this.cursor = Math.max(0, this.cursor - 1);
    const entry = this.entries[this.cursor];
    return entry ? { text: entry.text, mentions: entry.mentions.slice() } : null;
  }

  next(): PromptHistoryEntry | null {
    if (this.cursor === null) {
      return null;
    }

    if (this.cursor < this.entries.length - 1) {
      this.cursor += 1;
      const entry = this.entries[this.cursor];
      return entry ? { text: entry.text, mentions: entry.mentions.slice() } : null;
    }

    this.cursor = null;
    return {
      text: this.draft.text,
      mentions: this.draft.mentions.slice(),
    };
  }

  clearNavigation(): void {
    this.cursor = null;
  }

  isNavigating(): boolean {
    return this.cursor !== null;
  }
}
