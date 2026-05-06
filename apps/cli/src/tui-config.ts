import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type TuiConfig, TuiConfigSchema } from "@archer/shared";

const DEFAULT_TUI_CONFIG_FILE = "tui.json";
const TUI_CONFIG_ENV_VAR = "ARCHER_TUI_CONFIG";

export async function loadTuiConfig(cwd: string): Promise<TuiConfig> {
  const path = resolveTuiConfigPath(cwd);
  const explicitPath = Boolean(process.env[TUI_CONFIG_ENV_VAR]?.trim());

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      if (explicitPath) {
        console.warn(
          `[archer] ${TUI_CONFIG_ENV_VAR} points to a missing file: ${path}. Falling back to default keybinds.`,
        );
      }
      return {};
    }
    console.warn(`[archer] Failed reading TUI config at ${path}. Falling back to default keybinds.`);
    return {};
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    console.warn(`[archer] Invalid JSON in ${path}. Falling back to default keybinds.`);
    return {};
  }

  const parsedConfig = TuiConfigSchema.safeParse(parsedJson);
  if (!parsedConfig.success) {
    const firstIssue = parsedConfig.error.issues[0];
    const message = firstIssue
      ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
      : "invalid config";
    console.warn(
      `[archer] Invalid TUI config in ${path} (${message}). Falling back to default keybinds.`,
    );
    return {};
  }

  return parsedConfig.data;
}

function resolveTuiConfigPath(cwd: string): string {
  const configuredPath = process.env[TUI_CONFIG_ENV_VAR]?.trim();
  return resolve(
    cwd,
    configuredPath && configuredPath.length > 0 ? configuredPath : DEFAULT_TUI_CONFIG_FILE,
  );
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
