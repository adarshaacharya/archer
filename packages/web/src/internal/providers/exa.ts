import type { WebActionResult, WebSearchAction } from "@archer/shared/web";
import { asResults, asStringArray, fetchJson } from "../shared.js";

type WebSearchResult = Extract<WebActionResult, { type: "search" }>;

export async function searchExa(apiKey: string, input: WebSearchAction): Promise<WebSearchResult> {
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
    type: "search",
    provider: "exa",
    query: input.query,
    results,
  };
}
