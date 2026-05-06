import type { ToolResult } from "@archer/shared";
import { type CreateBashToolOptions, createBashTool } from "bash-tool";

export type BashToolName = "bash";

export interface BashToolsExecutor {
  executeTool(name: BashToolName, input: unknown): Promise<ToolResult>;
}

const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bchown\b/i,
  /\bchmod\s+-R\b/i,
  /\bmkfs\b/i,
  /\bdd\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

const NETWORK_PATTERNS: RegExp[] = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bnc\b/i,
  /\bnetcat\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\bsftp\b/i,
  /\bftp\b/i,
];

const REPO_ESCAPE_PATTERNS: RegExp[] = [/\bcd\s+\/\b/i, /\bcd\s+\.\.(\/|\b)/i, /(^|[^.\w])\.\.\//];

function asObject(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as { [Symbol.asyncIterator]: unknown })[Symbol.asyncIterator] === "function"
  );
}

async function resolveToolExecution<T>(value: T | AsyncIterable<T>): Promise<T> {
  if (!isAsyncIterable<T>(value)) {
    return value;
  }

  let last: T | undefined;
  for await (const chunk of value) {
    last = chunk;
  }

  if (last === undefined) {
    throw new Error("Tool returned an empty stream");
  }

  return last;
}

function validateCommand(command: string): string | null {
  if (!command.trim()) {
    return "Empty command is not allowed";
  }
  if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(command))) {
    return "Blocked: dangerous command pattern detected";
  }
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(command))) {
    return "Blocked: network command is not allowed";
  }
  if (REPO_ESCAPE_PATTERNS.some((pattern) => pattern.test(command))) {
    return "Blocked: command may escape repository workspace";
  }
  return null;
}

export async function createBashToolsExecutor(
  options?: CreateBashToolOptions,
): Promise<BashToolsExecutor> {
  const toolkit = await createBashTool({
    maxOutputLength: 12_000,
    ...options,
  });

  return {
    async executeTool(name: BashToolName, input: unknown): Promise<ToolResult> {
      try {
        const payload = asObject(input);

        if (name !== "bash") {
          return {
            ok: false,
            output: "",
            error: `Unsupported tool: ${name}`,
          };
        }

        const command = typeof payload.command === "string" ? payload.command : "";
        const invalidReason = validateCommand(command);
        if (invalidReason) {
          return {
            ok: false,
            output: "",
            error: invalidReason,
            meta: { command },
          };
        }

        if (!toolkit.tools.bash.execute) {
          throw new Error("bash tool execute function is unavailable");
        }

        const executionPromise = resolveToolExecution(
          await toolkit.tools.bash.execute({ command }, { toolCallId: "archer-bash", messages: [] }),
        );
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Command timed out after 30 seconds")), 30_000);
        });
        const result = await Promise.race([executionPromise, timeoutPromise]);

        return {
          ok: result.exitCode === 0,
          output: `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`,
          error: result.exitCode === 0 ? undefined : `Command exited with code ${result.exitCode}`,
          meta: { command },
        };
      } catch (error) {
        return {
          ok: false,
          output: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
