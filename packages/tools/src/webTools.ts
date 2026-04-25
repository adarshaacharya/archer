import { tool } from "ai";
import { z } from "zod";

export type WebSearchTopic = "general" | "news";

export type WebSearchParams = {
  query: string;
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  topic?: WebSearchTopic;
};

export type WebSearchResultItem = {
  title: string;
  url: string;
  snippet?: string;
};

export type WebSearchResponse = {
  provider: string;
  query: string;
  answer?: string;
  results: WebSearchResultItem[];
};

export type WebFetchParams = {
  url: string;
  maxChars?: number;
};

export type WebFetchResponse = {
  provider: string;
  url: string;
  title?: string;
  content: string;
};

export interface WebSearchProvider {
  search(input: WebSearchParams): Promise<WebSearchResponse>;
  fetch(input: WebFetchParams): Promise<WebFetchResponse>;
}

export function createWebSearchTool(provider: WebSearchProvider) {
  return tool({
    description:
      "Search the web for up-to-date external information. Use this for documentation, current facts, release notes, and sources outside the local repository.",
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      maxResults: z.number().int().min(1).max(10).optional(),
      includeDomains: z.array(z.string().min(1)).max(20).optional(),
      excludeDomains: z.array(z.string().min(1)).max(20).optional(),
      topic: z.enum(["general", "news"]).optional(),
    }),
    execute: async (input) => provider.search(input),
  });
}

export function createWebFetchTool(provider: WebSearchProvider) {
  return tool({
    description:
      "Fetch and extract readable content from a specific URL. Use this when you already know the page you need to inspect.",
    inputSchema: z.object({
      url: z.string().url(),
      maxChars: z.number().int().min(500).max(20000).optional(),
    }),
    execute: async (input) => provider.fetch(input),
  });
}
