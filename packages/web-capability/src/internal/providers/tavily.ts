import type { WebActionResult, WebSearchAction, WebSearchTopic } from "@archer/shared/web";
import { asResults, fetchJson } from "../shared.js";

type WebSearchResult = Extract<WebActionResult, { type: "search" }>;

export async function searchTavily(
  apiKey: string,
  input: WebSearchAction,
): Promise<WebSearchResult> {
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
    type: "search",
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
