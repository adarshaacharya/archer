import type {
  WebFetchParams,
  WebFetchResponse,
  WebSearchParams,
  WebSearchProvider,
  WebSearchResponse,
  WebSearchResultItem,
  WebSearchTopic,
} from "@xeq/tools";
import type { SupportedWebProvider } from "./auth-store.js";

type ActiveWebConfig = {
  provider: SupportedWebProvider;
  apiKey: string;
};

type WebPermissions = {
  allowUrl(url: string): Promise<void>;
};

function timeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
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

async function fetchJson(
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

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return items.length > 0 ? items : undefined;
}

function asResults(
  value: unknown,
  mapItem: (item: Record<string, unknown>) => WebSearchResultItem,
): WebSearchResultItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map(mapItem)
    .filter((item) => item.title.length > 0 || item.url.length > 0);
}

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(html: string): { title?: string; content: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawTitle = titleMatch?.[1];
  const title = rawTitle ? decodeHtml(rawTitle.trim()) : undefined;
  const content = decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  return { title, content };
}

async function searchTavily(apiKey: string, input: WebSearchParams): Promise<WebSearchResponse> {
  const payload = await fetchJson("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: input.query,
      topic: (input.topic ?? "general") as WebSearchTopic,
      search_depth: "basic",
      include_answer: true,
      max_results: input.maxResults ?? 5,
      include_domains: input.includeDomains,
      exclude_domains: input.excludeDomains,
    }),
  });

  return {
    provider: "tavily",
    query: typeof payload.query === "string" ? payload.query : input.query,
    answer: typeof payload.answer === "string" ? payload.answer : undefined,
    results: asResults(payload.results, (item) => ({
      title: typeof item.title === "string" ? item.title : "",
      url: typeof item.url === "string" ? item.url : "",
      snippet:
        typeof item.content === "string"
          ? item.content
          : typeof item.snippet === "string"
            ? item.snippet
            : undefined,
    })),
  };
}

async function searchExa(apiKey: string, input: WebSearchParams): Promise<WebSearchResponse> {
  const payload = await fetchJson("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query: input.query,
      type: "auto",
      text: true,
      numResults: input.maxResults ?? 5,
      includeDomains: input.includeDomains,
      category: input.topic === "news" ? "news" : undefined,
    }),
  });

  const excludedDomains = new Set(asStringArray(input.excludeDomains) ?? []);
  const results = asResults(payload.results, (item) => ({
    title: typeof item.title === "string" ? item.title : "",
    url: typeof item.url === "string" ? item.url : "",
    snippet:
      typeof item.text === "string"
        ? item.text
        : typeof item.highlight === "string"
          ? item.highlight
          : undefined,
  })).filter((item) => {
    if (excludedDomains.size === 0) return true;

    try {
      return !excludedDomains.has(new URL(item.url).hostname);
    } catch {
      return true;
    }
  });

  return {
    provider: "exa",
    query: input.query,
    results,
  };
}

export function createWebSearchProvider(
  resolveConfig: () => Promise<ActiveWebConfig>,
  permissions?: WebPermissions,
): WebSearchProvider {
  return {
    async search(input: WebSearchParams): Promise<WebSearchResponse> {
      const config = await resolveConfig();
      switch (config.provider) {
        case "exa":
          return searchExa(config.apiKey, input);
        default:
          return searchTavily(config.apiKey, input);
      }
    },
    async fetch(input: WebFetchParams): Promise<WebFetchResponse> {
      await permissions?.allowUrl(input.url);

      const response = await fetch(input.url, {
        headers: {
          "User-Agent": "xeq/0.1",
        },
        signal: timeoutSignal(20_000),
      });
      const html = await response.text();
      if (!response.ok) {
        throw new Error(`Fetch failed with status ${response.status}`);
      }

      const extracted = stripHtml(html);
      return {
        provider: "direct",
        url: input.url,
        title: extracted.title,
        content: extracted.content.slice(0, input.maxChars ?? 8000),
      };
    },
  };
}
