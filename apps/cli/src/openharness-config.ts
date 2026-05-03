import { readFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import {
  OpenHarnessRuntimeConfigSchema,
  type OpenHarnessRuntimeConfig,
} from "@xeq/shared";

const DEFAULT_OPEN_HARNESS_CONFIG_FILE = ".agents/openharness.json";
const OPEN_HARNESS_CONFIG_ENV_VAR = "XEQ_OPENHARNESS_CONFIG";

export async function loadOpenHarnessConfig(cwd: string): Promise<OpenHarnessRuntimeConfig> {
  const globalConfig = await readOpenHarnessConfig(resolveGlobalOpenHarnessConfigPath());
  const localConfig = await readOpenHarnessConfig(resolveOpenHarnessConfigPath(cwd));
  return mergeOpenHarnessConfigs(globalConfig, localConfig);
}

async function readOpenHarnessConfig(path: string): Promise<OpenHarnessRuntimeConfig | null> {
  const explicitPath = Boolean(process.env[OPEN_HARNESS_CONFIG_ENV_VAR]?.trim());

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      if (explicitPath) {
        console.warn(
          `[xeq] ${OPEN_HARNESS_CONFIG_ENV_VAR} points to a missing file: ${path}. Using built-in OpenHarness defaults.`,
        );
      }
      return null;
    }

    console.warn(`[xeq] Failed reading OpenHarness config at ${path}. Ignoring that file.`);
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    console.warn(`[xeq] Invalid JSON in ${path}. Ignoring that file.`);
    return null;
  }

  const parsedConfig = OpenHarnessRuntimeConfigSchema.safeParse(parsedJson);
  if (!parsedConfig.success) {
    const firstIssue = parsedConfig.error.issues[0];
    const message = firstIssue
      ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
      : "invalid config";
    console.warn(`[xeq] Invalid OpenHarness config in ${path} (${message}). Ignoring that file.`);
    return null;
  }

  return parsedConfig.data;
}

function resolveOpenHarnessConfigPath(cwd: string): string {
  const configuredPath = process.env[OPEN_HARNESS_CONFIG_ENV_VAR]?.trim();
  return resolve(
    cwd,
    configuredPath && configuredPath.length > 0 ? configuredPath : DEFAULT_OPEN_HARNESS_CONFIG_FILE,
  );
}

function resolveGlobalOpenHarnessConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  const baseDir =
    xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : resolve(os.homedir(), ".config");
  return resolve(baseDir, "xeq", "openharness.json");
}

function mergeOpenHarnessConfigs(
  globalConfig: OpenHarnessRuntimeConfig | null,
  localConfig: OpenHarnessRuntimeConfig | null,
): OpenHarnessRuntimeConfig {
  const mergedSkillPaths = new Set<string>();
  for (const path of globalConfig?.skills?.paths ?? []) {
    mergedSkillPaths.add(path);
  }
  for (const path of localConfig?.skills?.paths ?? []) {
    mergedSkillPaths.add(path);
  }

  return {
    projectInstructions:
      localConfig?.projectInstructions ?? globalConfig?.projectInstructions ?? true,
    skills:
      mergedSkillPaths.size > 0
        ? {
            paths: [...mergedSkillPaths],
          }
        : { paths: [] },
    mcpServers: {
      ...(globalConfig?.mcpServers ?? {}),
      ...(localConfig?.mcpServers ?? {}),
    },
    subagents: {
      enabled: localConfig?.subagents?.enabled ?? globalConfig?.subagents?.enabled ?? true,
    },
  };
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
