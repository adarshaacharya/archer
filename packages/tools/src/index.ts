import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SandboxPolicy } from "@archer/sandbox";
import type { ToolResult } from "@archer/shared";

export * from "./bashTools.js";
export * from "./controlTools.js";
export * from "./editTools.js";
export * from "./subagentTools.js";
export * from "./webTools.js";

export async function readFileTool(
  repoRoot: string,
  path: string,
  policy: SandboxPolicy,
): Promise<ToolResult> {
  const absolutePath = resolve(repoRoot, path);
  const decision = policy.decidePathAccess(absolutePath, "read");
  if (decision === "deny") {
    return {
      ok: false,
      output: "",
      error: `Denied by sandbox policy: ${path}`,
      meta: { path: absolutePath },
    };
  }

  try {
    const output = await readFile(absolutePath, "utf-8");
    return {
      ok: true,
      output,
      meta: { path: absolutePath },
    };
  } catch (error) {
    return {
      ok: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
      meta: { path: absolutePath },
    };
  }
}
