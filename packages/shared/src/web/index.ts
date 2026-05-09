import { z } from "zod";

export const WebModeSchema = z.enum(["disabled", "ask", "enabled"]);
export type WebMode = z.infer<typeof WebModeSchema>;

export const WebSearchTopicSchema = z.enum(["general", "news"]);
export type WebSearchTopic = z.infer<typeof WebSearchTopicSchema>;

export const WebSearchActionSchema = z.object({
  type: z.literal("search"),
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(10).optional(),
  includeDomains: z.array(z.string().min(1)).max(20).optional(),
  excludeDomains: z.array(z.string().min(1)).max(20).optional(),
  topic: WebSearchTopicSchema.optional(),
});
export type WebSearchAction = z.infer<typeof WebSearchActionSchema>;

export const WebOpenPageActionSchema = z.object({
  type: z.literal("openPage"),
  url: z.string().url(),
  maxChars: z.number().int().min(500).max(20000).optional(),
});
export type WebOpenPageAction = z.infer<typeof WebOpenPageActionSchema>;

export const WebFindInPageActionSchema = z.object({
  type: z.literal("findInPage"),
  url: z.string().url(),
  pattern: z.string().min(1).max(500),
  maxChars: z.number().int().min(500).max(20000).optional(),
});
export type WebFindInPageAction = z.infer<typeof WebFindInPageActionSchema>;

export const WebActionSchema = z.discriminatedUnion("type", [
  WebSearchActionSchema,
  WebOpenPageActionSchema,
  WebFindInPageActionSchema,
]);
export type WebAction = z.infer<typeof WebActionSchema>;

export const WebSearchResultItemSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().optional(),
});
export type WebSearchResultItem = z.infer<typeof WebSearchResultItemSchema>;

export const WebSearchActionResultSchema = z.object({
  type: z.literal("search"),
  provider: z.string().min(1),
  query: z.string().min(1),
  answer: z.string().optional(),
  results: z.array(WebSearchResultItemSchema),
});
export type WebSearchActionResult = z.infer<typeof WebSearchActionResultSchema>;

export const WebOpenPageActionResultSchema = z.object({
  type: z.literal("openPage"),
  provider: z.string().min(1),
  url: z.string().url(),
  title: z.string().optional(),
  content: z.string(),
});
export type WebOpenPageActionResult = z.infer<typeof WebOpenPageActionResultSchema>;

export const WebFindMatchSchema = z.object({
  line: z.number().int().positive(),
  text: z.string().min(1),
});
export type WebFindMatch = z.infer<typeof WebFindMatchSchema>;

export const WebFindInPageActionResultSchema = z.object({
  type: z.literal("findInPage"),
  provider: z.string().min(1),
  url: z.string().url(),
  pattern: z.string().min(1),
  matchCount: z.number().int().nonnegative(),
  matches: z.array(WebFindMatchSchema),
});
export type WebFindInPageActionResult = z.infer<typeof WebFindInPageActionResultSchema>;

export const WebActionResultSchema = z.discriminatedUnion("type", [
  WebSearchActionResultSchema,
  WebOpenPageActionResultSchema,
  WebFindInPageActionResultSchema,
]);
export type WebActionResult = z.infer<typeof WebActionResultSchema>;
