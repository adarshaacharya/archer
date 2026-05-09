import type { WebSearchResultItem } from "@archer/shared/web";

export function timeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

export async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Unexpected non-JSON response (${response.status})`);
  }
}

export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 20_000,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    signal: timeoutSignal(timeoutMs),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const payloadRecord =
      typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
    const error =
      typeof payloadRecord?.error === "string"
        ? payloadRecord.error
        : typeof payloadRecord?.message === "string"
          ? payloadRecord.message
          : `Request failed with status ${response.status}`;
    throw new Error(error);
  }

  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return items.length > 0 ? items : undefined;
}

export function asResults(
  value: unknown,
  mapItem: (item: Record<string, unknown>) => WebSearchResultItem,
): WebSearchResultItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map(mapItem)
    .filter((item) => item.title.length > 0 || item.url.length > 0);
}
