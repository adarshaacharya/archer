import type { WebAction, WebActionResult } from "@xeq/shared";

export type WebRuntimeEvent =
  | {
      type: "web.search.started";
      query: string;
    }
  | {
      type: "web.search.completed";
      query: string;
      resultCount: number;
      provider: string;
    }
  | {
      type: "web.search.failed";
      query: string;
      error: string;
    }
  | {
      type: "web.openPage.started";
      url: string;
    }
  | {
      type: "web.openPage.completed";
      url: string;
      provider: string;
      title?: string;
    }
  | {
      type: "web.openPage.failed";
      url: string;
      error: string;
    }
  | {
      type: "web.findInPage.started";
      url: string;
      pattern: string;
    }
  | {
      type: "web.findInPage.completed";
      url: string;
      pattern: string;
      provider: string;
      matchCount: number;
    }
  | {
      type: "web.findInPage.failed";
      url: string;
      pattern: string;
      error: string;
    };

export function createWebStartedEvent(action: WebAction): WebRuntimeEvent {
  switch (action.type) {
    case "search":
      return {
        type: "web.search.started",
        query: action.query,
      };
    case "openPage":
      return {
        type: "web.openPage.started",
        url: action.url,
      };
    case "findInPage":
      return {
        type: "web.findInPage.started",
        url: action.url,
        pattern: action.pattern,
      };
  }
}

export function createWebCompletedEvent(result: WebActionResult): WebRuntimeEvent {
  switch (result.type) {
    case "search":
      return {
        type: "web.search.completed",
        query: result.query,
        resultCount: result.results.length,
        provider: result.provider,
      };
    case "openPage":
      return {
        type: "web.openPage.completed",
        url: result.url,
        provider: result.provider,
        title: result.title,
      };
    case "findInPage":
      return {
        type: "web.findInPage.completed",
        url: result.url,
        pattern: result.pattern,
        provider: result.provider,
        matchCount: result.matchCount,
      };
  }
}

export function createWebFailedEvent(action: WebAction, error: string): WebRuntimeEvent {
  switch (action.type) {
    case "search":
      return {
        type: "web.search.failed",
        query: action.query,
        error,
      };
    case "openPage":
      return {
        type: "web.openPage.failed",
        url: action.url,
        error,
      };
    case "findInPage":
      return {
        type: "web.findInPage.failed",
        url: action.url,
        pattern: action.pattern,
        error,
      };
  }
}
