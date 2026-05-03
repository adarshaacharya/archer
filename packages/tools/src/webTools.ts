import type {
  WebAction,
  WebActionResult,
  WebSearchAction,
} from "@xeq/shared";
import { tool } from "ai";
import { z } from "zod";

export interface WebCapability {
  execute(action: WebAction): Promise<WebActionResult>;
}

export function createWebSearchTool(capability: WebCapability) {
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
    execute: async (input) => {
      const action: WebSearchAction = {
        type: "search",
        query: input.query,
        maxResults: input.maxResults,
        includeDomains: input.includeDomains,
        excludeDomains: input.excludeDomains,
        topic: input.topic,
      };
      return capability.execute(action);
    },
  });
}

export function createWebOpenPageTool(capability: WebCapability) {
  return tool({
    description:
      "Fetch and extract readable content from a specific URL. Use this when you already know the page you need to inspect.",
    inputSchema: z.object({
      url: z.string().url(),
      maxChars: z.number().int().min(500).max(20000).optional(),
    }),
    execute: async (input) =>
      capability.execute({
        type: "openPage",
        url: input.url,
        maxChars: input.maxChars,
      }),
  });
}

export function createWebFindInPageTool(capability: WebCapability) {
  return tool({
    description:
      "Find matching text inside a specific URL after loading its readable content. Use this when you know the page and need targeted evidence instead of scanning the whole page yourself.",
    inputSchema: z.object({
      url: z.string().url(),
      pattern: z.string().min(1).max(500),
      maxChars: z.number().int().min(500).max(20000).optional(),
    }),
    execute: async (input) =>
      capability.execute({
        type: "findInPage",
        url: input.url,
        pattern: input.pattern,
        maxChars: input.maxChars,
      }),
  });
}
