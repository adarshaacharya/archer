export function nextWrappedIndex(current: number, total: number, direction: "up" | "down"): number {
  if (total <= 0) return 0;
  if (direction === "up") return current <= 0 ? total - 1 : current - 1;
  return current >= total - 1 ? 0 : current + 1;
}

export function isArrowUp(seq: string): boolean {
  return seq === "\x1b[A";
}

export function isArrowDown(seq: string): boolean {
  return seq === "\x1b[B";
}

export function isTab(seq: string): boolean {
  return seq === "\t";
}

export function isEnter(seq: string): boolean {
  return seq === "\r";
}

export function isEscape(seq: string): boolean {
  return seq === "\x1b";
}
