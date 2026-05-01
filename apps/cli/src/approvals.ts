import { type ApprovalChoice, type ApprovalRequest } from "@xeq/sandbox";
import { type ApprovalMode } from "@xeq/shared";
import { type Tui } from "@xeq/tui";
import {
  type PermissionRequest,
  applyApprovalChoice,
  getSettingsFilePath,
  hasStoredPermission,
  readSettings,
} from "./settings-store.js";

export type LocalApprovalRequest = ApprovalRequest | PermissionRequest;

type ApprovalState = {
  approvalMode: ApprovalMode;
};

let approvalQueueTail: Promise<void> = Promise.resolve();

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
): Promise<ApprovalChoice> {
  const settings = await readSettings();
  if (hasStoredPermission(settings, request)) {
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
    message: "Choose approval mode",
    choices: [
      {
        value: "suggest",
        label: "suggest",
        description: "Review patch changes before they are applied",
      },
      {
        value: "auto-edit",
        label: "auto-edit",
        description: "Apply patch-based edits automatically",
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
  const normalized = mode?.trim().toLowerCase();
  const next =
    normalized === "suggest" || normalized === "auto-edit"
      ? (normalized as ApprovalMode)
      : await promptForApprovalMode(tui);

  if (next === "cancel") {
    return { type: "continue", message: "Approval mode selection cancelled." };
  }

  state.approvalMode = next;
  return {
    type: "continue",
    message: `Approval mode set to ${state.approvalMode}.`,
  };
}
