export function classifyToolCall(toolName: string, input: unknown) {
  if (["read", "list", "grep", "glob"].includes(toolName)) {
    return { permission: "read" as const, pattern: "*" };
  }

  if (["preparePatch", "preparePatchBundle", "write", "edit"].includes(toolName)) {
    return { permission: "edit" as const, pattern: "*" };
  }

  if (toolName === "bash") {
    return { permission: "bash" as const, pattern: commandPattern(input) };
  }

  if (toolName === "webFetch") {
    return { permission: "web_fetch" as const, pattern: "*" };
  }

  return { permission: "bash" as const, pattern: toolName };
}

function commandPattern(input: unknown): string {
  if (!input || typeof input !== "object") return "*";
  const command = (input as { command?: unknown }).command;
  if (typeof command !== "string") return "*";

  return command.split(/\s+/).slice(0, 2).join(" ") || "*";
}
