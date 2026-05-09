import { batch } from "solid-js";
import { findActiveMentionQuery, type MentionSuggestion } from "../mention-state.js";
import type { SlashCommandItem } from "../opentui-tui.js";
import { slashCommandMatches } from "./ui-helpers.js";

export function computeNextSlashState(input: {
  value: string;
  slashCommands: SlashCommandItem[];
  currentItems: SlashCommandItem[];
  currentIndex: number;
}): { items: SlashCommandItem[]; index: number; shouldClear: boolean } {
  if (!input.value.trim().startsWith("/")) {
    return { items: [], index: 0, shouldClear: true };
  }
  const items = slashCommandMatches(input.slashCommands, input.value);
  const previous = input.currentItems[input.currentIndex];
  const nextIndex = previous
    ? Math.max(
        0,
        items.findIndex((item) => item.name === previous.name),
      )
    : 0;
  return {
    items,
    index: items.length > 0 ? (nextIndex >= 0 ? nextIndex : 0) : 0,
    shouldClear: false,
  };
}

export function applyCollapsedMenuHeights(
  menuSelect: { options: unknown[]; selectedIndex: number; height: number },
  menuBox: { height: number },
): void {
  batch(() => {
    menuSelect.options = [];
    menuSelect.selectedIndex = 0;
    menuSelect.height = 0;
    menuBox.height = 0;
  });
}

export function computeMentionQuery(
  value: string,
  cursorOffset: number,
): ReturnType<typeof findActiveMentionQuery> {
  if (value.trim().startsWith("/")) return null;
  return findActiveMentionQuery(value, cursorOffset);
}

export function computeNextMentionState(input: {
  items: MentionSuggestion[];
  currentItems: MentionSuggestion[];
  currentIndex: number;
}): { index: number } {
  const previous = input.currentItems[input.currentIndex];
  const nextIndex = previous
    ? Math.max(
        0,
        input.items.findIndex((item) => item.path === previous.path),
      )
    : 0;
  return { index: input.items.length > 0 ? (nextIndex >= 0 ? nextIndex : 0) : 0 };
}
