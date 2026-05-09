import type { MentionSuggestion } from "../mention-state.js";
import type { SlashCommandItem } from "../opentui-tui.js";

export function computeMenuViewport(input: {
  total: number;
  index: number;
  scrollOffset: number;
  maxRows: number;
}): { visibleRows: number; scrollOffset: number } {
  const visibleRows = Math.min(input.total, input.maxRows);
  if (visibleRows === 0) return { visibleRows: 0, scrollOffset: 0 };

  let scrollOffset = input.scrollOffset;
  if (input.index < scrollOffset) scrollOffset = input.index;
  else if (input.index >= scrollOffset + visibleRows) scrollOffset = input.index - visibleRows + 1;

  const maxOffset = Math.max(0, input.total - visibleRows);
  if (scrollOffset > maxOffset) scrollOffset = maxOffset;
  return { visibleRows, scrollOffset };
}

export function mapSlashOptions(
  items: SlashCommandItem[],
  scrollOffset: number,
  maxRows: number,
): Array<{ name: string; description: string; value: number }> {
  return items.slice(scrollOffset, scrollOffset + maxRows).map((item, index) => ({
    name: `${item.name.padEnd(16)} ${item.description}`,
    description: "",
    value: scrollOffset + index,
  }));
}

export function mapMentionOptions(
  items: MentionSuggestion[],
  scrollOffset: number,
  maxRows: number,
): Array<{ name: string; description: string; value: number }> {
  return items.slice(scrollOffset, scrollOffset + maxRows).map((item, index) => ({
    name: item.label,
    description: "",
    value: scrollOffset + index,
  }));
}
