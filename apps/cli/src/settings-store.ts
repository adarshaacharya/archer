import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ApprovalChoice } from "@xeq/sandbox";

export type PermissionSettings = {
  version: 1;
  permissions: {
    fileWriteAllowRules: string[];
    commandAllowRules: string[];
    webFetchAllowRules: string[];
  };
};

export type PermissionRequest =
  | {
      kind: "file-write";
      target: string;
    }
  | {
      kind: "command";
      target: string;
    }
  | {
      kind: "web-fetch";
      target: string;
    };

const SETTINGS_DIR = path.join(os.homedir(), ".local", "share", "xeq");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

function emptySettings(): PermissionSettings {
  return {
    version: 1,
    permissions: {
      fileWriteAllowRules: [],
      commandAllowRules: [],
      webFetchAllowRules: [],
    },
  };
}

function parseSettings(raw: unknown): PermissionSettings {
  if (typeof raw !== "object" || raw === null) {
    return emptySettings();
  }

  const root = raw as Record<string, unknown>;
  const permissions =
    typeof root.permissions === "object" && root.permissions !== null ? root.permissions : {};
  const record = permissions as Record<string, unknown>;
  const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

  return {
    version: 1,
    permissions: {
      fileWriteAllowRules: asStringArray(record.fileWriteAllowRules),
      commandAllowRules: asStringArray(record.commandAllowRules),
      webFetchAllowRules: asStringArray(record.webFetchAllowRules),
    },
  };
}

export function getSettingsFilePath(): string {
  return SETTINGS_FILE;
}

export async function readSettings(): Promise<PermissionSettings> {
  try {
    const content = await readFile(SETTINGS_FILE, "utf8");
    return parseSettings(JSON.parse(content));
  } catch {
    return emptySettings();
  }
}

export async function writeSettings(settings: PermissionSettings): Promise<void> {
  await mkdir(SETTINGS_DIR, { recursive: true, mode: 0o700 });
  await writeFile(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o600,
  });
}

function getRuleList(settings: PermissionSettings, request: PermissionRequest): string[] {
  switch (request.kind) {
    case "command":
      return settings.permissions.commandAllowRules;
    case "file-write":
      return settings.permissions.fileWriteAllowRules;
    case "web-fetch":
      return settings.permissions.webFetchAllowRules;
  }
}

function setRuleList(
  settings: PermissionSettings,
  request: PermissionRequest,
  nextRules: string[],
): void {
  switch (request.kind) {
    case "command":
      settings.permissions.commandAllowRules = nextRules;
      break;
    case "file-write":
      settings.permissions.fileWriteAllowRules = nextRules;
      break;
    case "web-fetch":
      settings.permissions.webFetchAllowRules = nextRules;
      break;
  }
}

export function webFetchRuleForUrl(url: string): string | null {
  try {
    return `domain:${new URL(url).hostname}`;
  } catch {
    return null;
  }
}

export function hasStoredPermission(
  settings: PermissionSettings,
  request: PermissionRequest,
): boolean {
  return getRuleList(settings, request).includes(request.target);
}

export async function applyApprovalChoice(
  request: PermissionRequest,
  choice: ApprovalChoice,
): Promise<void> {
  if (choice !== "always") {
    return;
  }

  const settings = await readSettings();
  const rules = getRuleList(settings, request);
  if (!rules.includes(request.target)) {
    setRuleList(settings, request, [...rules, request.target]);
    await writeSettings(settings);
  }
}
