export function classifyToolCall(toolName: string, input: unknown) {
  if (["readFile", "listFiles", "grep"].includes(toolName)) {
    return { permission: "read" as const, pattern: "*" };
  }

  if (["preparePatch", "preparePatchBundle"].includes(toolName)) {
    return { permission: "patch_review" as const, pattern: "*" };
  }

  if (["writeFile", "editFile", "deleteFile"].includes(toolName)) {
    return { permission: "edit" as const, pattern: filePattern(input) };
  }

  if (toolName === "bash") {
    return { permission: "bash" as const, pattern: commandPattern(input) };
  }

  if (toolName === "webFetch") {
    return { permission: "web_fetch" as const, pattern: "*" };
  }

  return { permission: "bash" as const, pattern: toolName };
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
