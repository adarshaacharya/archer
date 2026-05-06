import { readFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { OpenHarnessRuntimeConfigSchema, type OpenHarnessRuntimeConfig } from "@archer/shared";

export async function loadOpenHarnessConfig(): Promise<OpenHarnessRuntimeConfig> {
  const [globalProjectConfig, globalMcpConfig] = await Promise.all([
    readOpenHarnessConfig(resolveGlobalOpenHarnessProjectConfigPath()),
    readOpenHarnessConfig(resolveGlobalOpenHarnessMcpConfigPath()),
  ]);

  return mergeOpenHarnessConfigs(globalProjectConfig, globalMcpConfig);
}

async function readOpenHarnessConfig(path: string): Promise<OpenHarnessRuntimeConfig | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    console.warn(`[archer] Failed reading OpenHarness config at ${path}. Ignoring that file.`);
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    console.warn(`[archer] Invalid JSON in ${path}. Ignoring that file.`);
    return null;
  }

  const parsedConfig = OpenHarnessRuntimeConfigSchema.safeParse(parsedJson);
  if (!parsedConfig.success) {
    const firstIssue = parsedConfig.error.issues[0];
    const message = firstIssue
      ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
      : "invalid config";
    console.warn(
      `[archer] Invalid OpenHarness config in ${path} (${message}). Ignoring that file.`,
    );
    return null;
  }

  return parsedConfig.data;
}

function resolveGlobalOpenHarnessProjectConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  const baseDir =
    xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : resolve(os.homedir(), ".config");
  return resolve(baseDir, "archer", "settings.json");
}

function resolveGlobalOpenHarnessMcpConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  const baseDir =
    xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : resolve(os.homedir(), ".config");
  return resolve(baseDir, "archer", "mcp.json");
}

function mergeOpenHarnessConfigs(
  globalProjectConfig: OpenHarnessRuntimeConfig | null,
  globalMcpConfig: OpenHarnessRuntimeConfig | null,
): OpenHarnessRuntimeConfig {
  const mergedSkillPaths = new Set<string>();
  for (const path of globalProjectConfig?.skills?.paths ?? []) {
    mergedSkillPaths.add(path);
  }

  return {
    projectInstructions: globalProjectConfig?.projectInstructions ?? true,
    skills:
      mergedSkillPaths.size > 0
        ? {
            paths: [...mergedSkillPaths],
          }
        : { paths: [] },
    mcpServers: {
      ...(globalMcpConfig?.mcpServers ?? {}),
    },
    subagents: {
      enabled: globalProjectConfig?.subagents?.enabled ?? true,
    },
  };
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
