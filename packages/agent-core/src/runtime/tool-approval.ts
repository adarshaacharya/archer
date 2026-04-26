import { classifyCommandRisk } from "@xeq/sandbox";

export type ToolApprovalAction = "allow" | "ask" | "deny";

export function classifyToolCall(
  toolName: string,
  input: unknown,
): {
  permission: "read" | "edit" | "bash" | "web_fetch" | "patch_review" | "unknown";
  pattern: string;
  action: ToolApprovalAction;
} {
  if (["readFile", "listFiles", "grep"].includes(toolName)) {
    return { permission: "read", pattern: "*", action: "allow" };
  }

  if (["preparePatch", "preparePatchBundle"].includes(toolName)) {
    return { permission: "patch_review", pattern: "*", action: "allow" };
  }

  if (["writeFile", "editFile", "deleteFile"].includes(toolName)) {
    return { permission: "edit", pattern: filePattern(input), action: "allow" };
  }

  if (toolName === "bash") {
    const pattern = commandPattern(input);
    return {
      permission: "bash",
      pattern,
      action: classifyCommandRisk(pattern),
    };
  }

  if (toolName === "webFetch") {
    return { permission: "web_fetch", pattern: "*", action: "allow" };
  }

  return { permission: "unknown", pattern: toolName, action: "ask" };
}

function filePattern(input: unknown): string {
  if (!input || typeof input !== "object") return "*";
  const filePath = (input as { filePath?: unknown }).filePath;
  if (typeof filePath !== "string" || filePath.trim() === "") return "*";

  return filePath;
}

function commandPattern(input: unknown): string {
  if (!input || typeof input !== "object") return "*";
  const command = (input as { command?: unknown }).command;
  if (typeof command !== "string") return "*";

  return command.split(/\s+/).slice(0, 2).join(" ") || "*";
}
