import type { OpenHarnessToolEvent } from "@xeq/agent-core";

type SubagentStatusLike = {
  subagentId?: string;
  status?: string;
  sessionId?: string;
  result?: string;
  error?: string;
};

type SubagentAwaitLike = {
  mode?: string;
  results?: Array<SubagentStatusLike & { subagentId?: string }>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asSubagentStatusLike(value: unknown): SubagentStatusLike | null {
  if (!isObject(value)) {
    return null;
  }

  const status = typeof value.status === "string" ? value.status : undefined;
  const subagentId = typeof value.subagentId === "string" ? value.subagentId : undefined;
  const sessionId = typeof value.sessionId === "string" ? value.sessionId : undefined;
  const result = typeof value.result === "string" ? value.result : undefined;
  const error = typeof value.error === "string" ? value.error : undefined;

  if (!status && !subagentId && !sessionId && !result && !error) {
    return null;
  }

  return {
    subagentId,
    status,
    sessionId,
    result,
    error,
  };
}

function formatSessionSuffix(sessionId?: string): string {
  return sessionId ? ` session=${sessionId}` : "";
}

function formatSubagentStatusLine(prefix: string, status: SubagentStatusLike): string {
  const id = status.subagentId ?? "(unknown)";
  const session = formatSessionSuffix(status.sessionId);
  const result = status.result ? ` result=${status.result}` : "";
  const error = status.error ? ` error=${status.error}` : "";
  return `${prefix} ${id} ${status.status ?? "unknown"}${session}${result}${error}`;
}

function formatSubagentCancelLine(value: unknown): string | null {
  if (!isObject(value)) {
    return null;
  }

  const subagentId = typeof value.subagentId === "string" ? value.subagentId : undefined;
  const cancelled = typeof value.cancelled === "boolean" ? value.cancelled : undefined;
  if (!subagentId && cancelled == null) {
    return null;
  }

  return `subagent cancel ${subagentId ?? "(unknown)"} ${cancelled ? "cancelled" : "not-cancelled"}`;
}

function formatAwaitResult(value: unknown): string | null {
  if (!isObject(value)) {
    return null;
  }

  const mode = typeof value.mode === "string" ? value.mode : undefined;
  const results = Array.isArray(value.results) ? value.results : null;
  if (!mode || !results) {
    return null;
  }

  const parts = results
    .map((item) => asSubagentStatusLike(item))
    .filter((item): item is SubagentStatusLike => item !== null)
    .map((item) => formatSubagentStatusLine("subagent", item));

  return `subagent await mode=${mode} count=${parts.length}${parts.length > 0 ? `\n${parts.join("\n")}` : ""}`;
}

export function formatSubagentRuntimeEvent(event: OpenHarnessToolEvent): string | null {
  if (event.phase === "start") {
    if (
      event.toolName === "spawnSubagent" ||
      event.toolName === "subagentStatus" ||
      event.toolName === "subagentCancel" ||
      event.toolName === "subagentAwait"
    ) {
      return `subagent ${event.toolName} started`;
    }
    return null;
  }

  if (event.phase === "error") {
    if (
      event.toolName === "spawnSubagent" ||
      event.toolName === "subagentStatus" ||
      event.toolName === "subagentCancel" ||
      event.toolName === "subagentAwait"
    ) {
      return `subagent ${event.toolName} failed: ${event.error}`;
    }
    return null;
  }

  if (
    event.toolName === "spawnSubagent" ||
    event.toolName === "subagentStatus"
  ) {
    const status = asSubagentStatusLike(event.output);
    if (!status) {
      return null;
    }
    const prefix = event.toolName === "spawnSubagent" ? "subagent spawn" : "subagent status";
    return formatSubagentStatusLine(prefix, status);
  }

  if (event.toolName === "subagentCancel") {
    return formatSubagentCancelLine(event.output);
  }

  if (event.toolName === "subagentAwait") {
    const awaitResult = formatAwaitResult(event.output);
    return awaitResult ? awaitResult : null;
  }

  return null;
}
