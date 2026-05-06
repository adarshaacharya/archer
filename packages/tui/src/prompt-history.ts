import type { ComposerMentionBinding } from "@archer/shared";

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
  private readonly localEntries: PromptHistoryEntry[] = [];
  private persistentTexts: string[] = [];
  private draft: PromptHistoryEntry = { text: "", mentions: [] };
  private cursor: number | null = null;

  constructor(private readonly limit: number = DEFAULT_HISTORY_LIMIT) {}

  loadPersistentTexts(entries: string[]): void {
    this.persistentTexts = entries
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(-this.limit);
    this.cursor = null;
  }

  record(submit: PromptHistoryEntry | string): void {
    const entry = normalizeEntry(submit);
    const value = entry.text.trim();
    this.cursor = null;
    this.draft = { text: "", mentions: [] };

    if (!value) {
      return;
    }

    this.localEntries.push({
      text: value,
      mentions: entry.mentions.slice(),
    });
    if (this.localEntries.length > this.limit) {
      this.localEntries.splice(0, this.localEntries.length - this.limit);
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
    const entries = this.combinedEntries();
    if (entries.length === 0) {
      return null;
    }

    if (this.cursor === null) {
      this.draft = normalizeEntry(current);
      this.cursor = entries.length - 1;
      const entry = entries[this.cursor];
      return entry ? { text: entry.text, mentions: entry.mentions.slice() } : null;
    }

    this.cursor = Math.max(0, this.cursor - 1);
    const entry = entries[this.cursor];
    return entry ? { text: entry.text, mentions: entry.mentions.slice() } : null;
  }

  next(): PromptHistoryEntry | null {
    const entries = this.combinedEntries();
    if (this.cursor === null) {
      return null;
    }

    if (this.cursor < entries.length - 1) {
      this.cursor += 1;
      const entry = entries[this.cursor];
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

  private combinedEntries(): PromptHistoryEntry[] {
    return [
      ...this.persistentTexts.map((text) => ({ text, mentions: [] as ComposerMentionBinding[] })),
      ...this.localEntries,
    ].slice(-this.limit);
  }
}
