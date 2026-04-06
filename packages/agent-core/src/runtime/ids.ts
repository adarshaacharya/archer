export function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}
