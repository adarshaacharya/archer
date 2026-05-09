import type { WebActionResult, WebSearchAction, WebSearchResultItem } from "@archer/shared/web";

type WebSearchResult = Extract<WebActionResult, { type: "search" }>;

function normalize(items: WebSearchResultItem[], excluded: Set<string>): WebSearchResultItem[] {
  const seen = new Set<string>();
  const output: WebSearchResultItem[] = [];
  for (const item of items) {
    if (!item.url) continue;
    if (seen.has(item.url)) continue;
    try {
      const host = new URL(item.url).hostname;
      if (excluded.has(host)) continue;
    } catch {
      continue;
    }
    seen.add(item.url);
    output.push(item);
  }
  return output;
}

async function searchWikipedia(query: string): Promise<WebSearchResultItem[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&namespace=0&format=json`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload) || payload.length < 4) return [];
  const titles = Array.isArray(payload[1]) ? payload[1] : [];
  const snippets = Array.isArray(payload[2]) ? payload[2] : [];
  const urls = Array.isArray(payload[3]) ? payload[3] : [];
  const results: WebSearchResultItem[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    const title = typeof titles[i] === "string" ? titles[i] : "";
    const snippet = typeof snippets[i] === "string" ? snippets[i] : undefined;
    const itemUrl = typeof urls[i] === "string" ? urls[i] : "";
    if (!itemUrl) continue;
    results.push({ title, url: itemUrl, snippet });
  }
  return results;
}

async function searchHackerNews(query: string): Promise<WebSearchResultItem[]> {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const payload = (await response.json()) as Record<string, unknown>;
  const hits = Array.isArray(payload.hits) ? payload.hits : [];
  const results: WebSearchResultItem[] = [];
  for (const hit of hits) {
    if (typeof hit !== "object" || hit === null) continue;
    const item = hit as Record<string, unknown>;
    const itemUrl = typeof item.url === "string" ? item.url : "";
    if (!itemUrl) continue;
    const title = typeof item.title === "string" ? item.title : "Hacker News result";
    const snippet =
      typeof item.story_text === "string"
        ? item.story_text
        : typeof item.comment_text === "string"
          ? item.comment_text
          : undefined;
    results.push({ title, url: itemUrl, snippet });
  }
  return results;
}

export async function searchArcherScout(input: WebSearchAction): Promise<WebSearchResult> {
  const excludedDomains = new Set(input.excludeDomains ?? []);
  const [wiki, hn] = await Promise.all([searchWikipedia(input.query), searchHackerNews(input.query)]);
  const merged = normalize([...wiki, ...hn], excludedDomains);
  const results = merged.slice(0, input.maxResults ?? 5);
  return {
    type: "search",
    provider: "archer-scout",
    query: input.query,
    answer: "Archer Scout is a built-in free web search with limited source coverage.",
    results,
  };
}
