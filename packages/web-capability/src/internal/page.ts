import type { WebAction, WebActionResult, WebFindMatch, WebOpenPageAction } from "@archer/shared/web";
import type { WebPermissions } from "../index.js";
import { timeoutSignal } from "./shared.js";

type WebOpenPageResult = Extract<WebActionResult, { type: "openPage" }>;
type WebFindInPageResult = Extract<WebActionResult, { type: "findInPage" }>;

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

export async function openPage(
  input: WebOpenPageAction,
  permissions?: WebPermissions,
): Promise<WebOpenPageResult> {
  await permissions?.allowUrl(input.url);

  const response = await fetch(input.url, {
    headers: {
      "User-Agent": "archer/0.1",
    },
    signal: timeoutSignal(20_000),
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}`);
  }

  const extracted = stripHtml(html);
  return {
    type: "openPage",
    provider: "direct",
    url: input.url,
    title: extracted.title,
    content: extracted.content.slice(0, input.maxChars ?? 8000),
  };
}

function findMatches(content: string, pattern: string): WebFindMatch[] {
  const loweredPattern = pattern.toLowerCase();
  return content
    .split(/\n+/)
    .map((line, index) => ({
      line: index + 1,
      text: line.trim(),
    }))
    .filter((match) => match.text.length > 0 && match.text.toLowerCase().includes(loweredPattern))
    .slice(0, 20);
}

export async function findInPage(
  input: Extract<WebAction, { type: "findInPage" }>,
  permissions?: WebPermissions,
): Promise<WebFindInPageResult> {
  const page = await openPage(
    {
      type: "openPage",
      url: input.url,
      maxChars: input.maxChars,
    },
    permissions,
  );

  const matches = findMatches(page.content, input.pattern);
  return {
    type: "findInPage",
    provider: page.provider,
    url: input.url,
    pattern: input.pattern,
    matchCount: matches.length,
    matches,
  };
}
