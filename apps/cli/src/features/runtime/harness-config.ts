import { readFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { type HarnessRuntimeConfig, HarnessRuntimeConfigSchema } from "@archer/shared/runtime";

export async function loadHarnessConfig(): Promise<HarnessRuntimeConfig> {
  const [globalProjectConfig, globalMcpConfig] = await Promise.all([
    readHarnessConfig(resolveGlobalHarnessProjectConfigPath()),
    readHarnessConfig(resolveGlobalHarnessMcpConfigPath()),
  ]);

  return mergeHarnessConfigs(globalProjectConfig, globalMcpConfig);
}

async function readHarnessConfig(path: string): Promise<HarnessRuntimeConfig | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    console.warn(`[archer] Failed reading harness config at ${path}. Ignoring that file.`);
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    console.warn(`[archer] Invalid JSON in ${path}. Ignoring that file.`);
    return null;
  }

  const parsedConfig = HarnessRuntimeConfigSchema.safeParse(parsedJson);
  if (!parsedConfig.success) {
    const firstIssue = parsedConfig.error.issues[0];
    const message = firstIssue
      ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
      : "invalid config";
    console.warn(`[archer] Invalid harness config in ${path} (${message}). Ignoring that file.`);
    return null;
  }

  return parsedConfig.data;
}

function resolveGlobalHarnessProjectConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  const baseDir =
    xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : resolve(os.homedir(), ".config");
  return resolve(baseDir, "archer", "settings.json");
}

function resolveGlobalHarnessMcpConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  const baseDir =
    xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : resolve(os.homedir(), ".config");
  return resolve(baseDir, "archer", "mcp.json");
}

function mergeHarnessConfigs(
  globalProjectConfig: HarnessRuntimeConfig | null,
  globalMcpConfig: HarnessRuntimeConfig | null,
): HarnessRuntimeConfig {
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
    policy: {
      rules: globalProjectConfig?.policy?.rules ?? [],
    },
  };
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
