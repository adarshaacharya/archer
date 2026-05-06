import path from "node:path";
import type { ApprovalChoice, ApprovalRequest } from "@archer/sandbox";
import {
  type ApprovalMode,
  autoApproveCommandsInApprovalMode,
  autoApproveEditsInApprovalMode,
  canWriteInApprovalMode,
  normalizeApprovalMode,
} from "@archer/shared";
import type { Tui } from "@archer/tui";
import {
  applyApprovalChoice,
  getSettingsFilePath,
  hasStoredPermission,
  type PermissionRequest,
  readSettings,
} from "./settings-store.js";

export type LocalApprovalRequest = ApprovalRequest | PermissionRequest;

type ApprovalState = {
  approvalMode: ApprovalMode;
};

type SessionApprovalCacheEntry =
  | {
      kind: "command" | "web-fetch";
      target: string;
    }
  | {
      kind: "file-write";
      target: string;
      scope: "directory";
    };

const sessionApprovalCaches = new Map<string, SessionApprovalCacheEntry[]>();

let approvalQueueTail: Promise<void> = Promise.resolve();

function normalizeTarget(target: string): string {
  return path.resolve(target);
}

function fileWriteCacheEntry(target: string): SessionApprovalCacheEntry {
  return {
    kind: "file-write",
    target: path.dirname(normalizeTarget(target)),
    scope: "directory",
  };
}

function matchesSessionApproval(
  entry: SessionApprovalCacheEntry,
  request: LocalApprovalRequest,
): boolean {
  if (entry.kind !== request.kind) {
    return false;
  }

  if (entry.kind === "file-write" && request.kind === "file-write") {
    const root = normalizeTarget(entry.target);
    const target = normalizeTarget(request.target);
    const relative = path.relative(root, target);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  return entry.target === request.target;
}

function getSessionApprovalCache(sessionId: string): SessionApprovalCacheEntry[] {
  let cache = sessionApprovalCaches.get(sessionId);
  if (!cache) {
    cache = [];
    sessionApprovalCaches.set(sessionId, cache);
  }
  return cache;
}

export function clearSessionApprovalCache(sessionId?: string): void {
  if (sessionId) {
    sessionApprovalCaches.delete(sessionId);
    return;
  }

  sessionApprovalCaches.clear();
}

export function hasSessionApproval(sessionId: string, request: LocalApprovalRequest): boolean {
  return getSessionApprovalCache(sessionId).some((entry) => matchesSessionApproval(entry, request));
}

export function rememberSessionApproval(sessionId: string, request: LocalApprovalRequest): void {
  const cache = getSessionApprovalCache(sessionId);
  const entry =
    request.kind === "file-write"
      ? fileWriteCacheEntry(request.target)
      : {
          kind: request.kind,
          target: request.target,
        };

  if (!cache.some((existing) => matchesSessionApproval(existing, request))) {
    cache.push(entry);
  }
}

export function withApprovalQueue<T>(task: () => Promise<T>): Promise<T> {
  const run = approvalQueueTail.then(task, task);
  approvalQueueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function describeApprovalRequest(request: LocalApprovalRequest): string {
  switch (request.kind) {
    case "command":
      return "Allow bash command?";
    case "file-write":
      return request.details ? "Review patch before applying?" : "Allow file write?";
    case "web-fetch":
      return "Allow web fetch?";
  }
}

export async function requestApproval(
  tui: Tui,
  request: LocalApprovalRequest,
  sessionId?: string,
): Promise<ApprovalChoice> {
  if (sessionId) {
    if (hasSessionApproval(sessionId, request)) {
      return "once";
    }
  }

  const settings = await readSettings();
  if (hasStoredPermission(settings, request)) {
    if (sessionId) {
      rememberSessionApproval(sessionId, request);
    }
    return "always";
  }

  const result = await withApprovalQueue(() =>
    tui.promptApproval({
      message: describeApprovalRequest(request),
      details: [request.target, request.details].filter(Boolean).join("\n"),
      choices: [
        {
          value: "reject",
          label: "Reject",
          description: "Deny this action",
        },
        {
          value: "once",
          label: "Approve once",
          description: "Allow this action this time only",
        },
        {
          value: "always",
          label: "Always approve",
          description: "Remember this rule for next time",
        },
      ],
    }),
  );

  if (result === "always") {
    await applyApprovalChoice(request, "always");
  }

  if (result === "once" && sessionId) {
    rememberSessionApproval(sessionId, request);
  }

  return result as ApprovalChoice;
}

export async function permissionsSummary(): Promise<string> {
  const settings = await readSettings();
  return [
    `file_writes=${settings.permissions.fileWriteAllowRules.length}`,
    `commands=${settings.permissions.commandAllowRules.length}`,
    `web_fetch=${settings.permissions.webFetchAllowRules.length}`,
    `store=${getSettingsFilePath()}`,
  ].join("  ");
}

export async function promptForApprovalMode(tui: Tui): Promise<ApprovalMode | "cancel"> {
  const selected = await tui.promptApproval({
    message: "Choose permission profile",
    choices: [
      {
        value: "read-only",
        label: "read-only",
        description: "No file writes; read and inspect only",
      },
      {
        value: "workspace-write",
        label: "workspace-write",
        description: "Allow workspace edits with approval prompts",
      },
      {
        value: "danger-full-access",
        label: "danger-full-access",
        description: "Allow edits and commands without prompts",
      },
    ],
  });

  if (selected === "reject") return "cancel";
  return selected as ApprovalMode;
}

export async function setApprovalMode(
  tui: Tui,
  state: ApprovalState,
  mode?: string,
): Promise<{ type: "continue"; message: string }> {
  const next = mode ? normalizeApprovalMode(mode) : await promptForApprovalMode(tui);

  if (next === "cancel") {
    return { type: "continue", message: "Approval mode selection cancelled." };
  }

  if (!next) {
    return {
      type: "continue",
      message: "Unknown permission profile. Use read-only, workspace-write, or danger-full-access.",
    };
  }

  state.approvalMode = next;
  const capabilities = [
    canWriteInApprovalMode(next) ? "writes-enabled" : "writes-disabled",
    autoApproveEditsInApprovalMode(next) ? "auto-edit" : "review-edits",
    autoApproveCommandsInApprovalMode(next) ? "auto-command" : "review-commands",
  ].join(", ");
  return {
    type: "continue",
    message: `Permission profile set to ${state.approvalMode} (${capabilities}).`,
  };
}
