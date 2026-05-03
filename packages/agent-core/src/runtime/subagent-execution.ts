import {
  Agent,
  Session,
  createFsTools,
  createLocalTools,
  type ApproveFn,
} from "@openharness/core";
import {
  createEditTools,
  createWebFindInPageTool,
  createWebOpenPageTool,
  createWebSearchTool,
} from "@xeq/tools";
import {
  loadEffectiveModelMessages,
  replaceMessages,
} from "@xeq/storage";
import type { ModelMessage } from "ai";
import { resolve } from "node:path";
import { DEFAULT_MAX_STEPS } from "../types.js";
import { createTrackedFsProvider } from "./file-tracker.js";
import { sanitizeId } from "./ids.js";
import { resolveModel } from "./model.js";
import type {
  SpawnSubagentInput,
  SpawnSubagentResult,
  OpenHarnessRuntimeConfig,
} from "@xeq/shared";
import type { OpenHarnessRuntimeDeps, RuntimeProviders } from "./openharness-types.js";
import type { ToolSet } from "ai";

type SpawnSubagentExecutorOptions = {
  cwd: string;
  parentSessionId: string;
  providers: RuntimeProviders;
  runtimeConfig?: OpenHarnessRuntimeConfig;
  modelId?: string;
  approveToolCall?: ApproveFn;
  approvePatchApply?: OpenHarnessRuntimeDeps["approvePatchApply"];
};

type ToolSetLike = Partial<ToolSet>;

function cloneToolSet(tools: ToolSetLike, allowedNames: Set<string>): ToolSet {
  const selectedEntries = Object.entries(tools).filter(([name]) => allowedNames.has(name));
  return Object.fromEntries(selectedEntries) as ToolSet;
}

function toIsoString(value: number): string {
  return new Date(value).toISOString();
}

function modelMessageToText(content: ModelMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (typeof part === "object" && part !== null) {
          const record = part as Record<string, unknown>;
          if (typeof record.text === "string") {
            return record.text;
          }
          if (typeof record.content === "string") {
            return record.content;
          }
        }
        try {
          return JSON.stringify(part);
        } catch {
          return String(part);
        }
      })
      .join("\n");
  }

  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function extractFindings(text: string): string[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletLines = lines.filter((line) => /^([-*•]|\d+\.)\s+/.test(line));
  const cleaned = (bulletLines.length > 0 ? bulletLines : lines.slice(0, 8)).map((line) =>
    line.replace(/^([-*•]|\d+\.)\s+/, ""),
  );
  return Array.from(new Set(cleaned)).slice(0, 8);
}

function extractCitations(text: string): Array<{ type: "file" | "url"; ref: string; excerpt?: string }> {
  const citations: Array<{ type: "file" | "url"; ref: string; excerpt?: string }> = [];
  const fileMatches = text.match(/\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\b/g) ?? [];
  const urlMatches = text.match(/https?:\/\/[^\s)<>"'`]+/g) ?? [];

  for (const file of new Set(fileMatches)) {
    citations.push({ type: "file", ref: file });
  }

  for (const url of new Set(urlMatches)) {
    citations.push({ type: "url", ref: url });
  }

  return citations.slice(0, 12);
}

function buildChildToolSet(
  input: SpawnSubagentInput,
  providers: RuntimeProviders,
  approvePatchApply?: SpawnSubagentExecutorOptions["approvePatchApply"],
) {
  const localTools = createLocalTools({ fs: providers.fs, shell: providers.shell });
  const readOnlyTools = createFsTools(providers.fs);
  const editTools = createEditTools(providers.fs, {
    onPatchPreview: async (preview) => {
      if (!approvePatchApply) {
        return true;
      }

      return approvePatchApply(
        "files" in preview
          ? {
              bundleId: preview.bundleId,
              filePath: preview.bundleId,
              diff: preview.files
                .map((patch) => `### ${patch.filePath}\n${patch.diff}`)
                .join("\n\n"),
              summary: preview.summary,
              changedFilesCount: preview.changedFilesCount,
              files: preview.files.map((patch) => ({
                filePath: patch.filePath,
                diff: patch.diff,
                status: patch.status,
              })),
            }
          : {
              patchId: preview.patchId,
              filePath: preview.filePath,
              diff: preview.diff,
              files: [
                {
                  filePath: preview.filePath,
                  diff: preview.diff,
                  status: preview.status,
                },
              ],
            },
      );
    },
  });

  const candidateTools: ToolSetLike = {
    bash: localTools.bash,
    createDirectory: editTools.createDirectory,
    deleteFile: localTools.deleteFile,
    editFile: localTools.editFile,
    grep: readOnlyTools.grep,
    listFiles: readOnlyTools.listFiles,
    preparePatch: editTools.preparePatch,
    preparePatchBundle: editTools.preparePatchBundle,
    readFile: readOnlyTools.readFile,
    writeFile: localTools.writeFile,
  };

  if (providers.web) {
    candidateTools.webFindInPage = createWebFindInPageTool(providers.web);
    candidateTools.webOpenPage = createWebOpenPageTool(providers.web);
    candidateTools.webSearch = createWebSearchTool(providers.web);
  }

  const defaultAllowed = new Set<string>();
  if (input.scope.type === "repo" || input.scope.type === "mixed") {
    defaultAllowed.add("readFile");
    defaultAllowed.add("listFiles");
    defaultAllowed.add("grep");
  }
  if (input.scope.type === "web" || input.scope.type === "mixed") {
    defaultAllowed.add("webSearch");
    defaultAllowed.add("webOpenPage");
    defaultAllowed.add("webFindInPage");
  }
  if (input.kind === "implement" || input.kind === "custom") {
    defaultAllowed.add("createDirectory");
    defaultAllowed.add("preparePatch");
    defaultAllowed.add("preparePatchBundle");
    defaultAllowed.add("editFile");
    defaultAllowed.add("writeFile");
  }
  if (input.kind === "custom") {
    defaultAllowed.add("bash");
    defaultAllowed.add("deleteFile");
  }

  let allowed = new Set(defaultAllowed);
  if (input.toolPolicy?.allow && input.toolPolicy.allow.length > 0) {
    allowed = new Set(input.toolPolicy.allow.filter((name: string) => defaultAllowed.has(name)));
  }
  if (input.toolPolicy?.deny && input.toolPolicy.deny.length > 0) {
    for (const name of input.toolPolicy.deny as string[]) {
      allowed.delete(name);
    }
  }

  return cloneToolSet(candidateTools, allowed);
}

function buildChildSystemPrompt(input: SpawnSubagentInput, cwd: string): string {
  let scopeDetails: string;
  if (input.scope.type === "repo") {
    scopeDetails = `Repository scope: ${
      input.scope.paths.length > 0
        ? input.scope.paths.map((path: string) => resolve(cwd, path)).join(", ")
        : "(workspace root)"
    }`;
  } else if (input.scope.type === "web") {
    const details = [
      input.scope.urls.length > 0 ? `urls=${input.scope.urls.join(", ")}` : null,
      input.scope.domains.length > 0 ? `domains=${input.scope.domains.join(", ")}` : null,
    ].filter(Boolean);
    scopeDetails = `Web scope: ${details.length > 0 ? details.join("; ") : "(no explicit urls or domains)"}`;
  } else {
    const details = [
      input.scope.repoPaths.length > 0
        ? `repoPaths=${input.scope.repoPaths.map((path: string) => resolve(cwd, path)).join(", ")}`
        : null,
      input.scope.urls.length > 0 ? `urls=${input.scope.urls.join(", ")}` : null,
      input.scope.domains.length > 0 ? `domains=${input.scope.domains.join(", ")}` : null,
    ].filter(Boolean);
    scopeDetails = `Mixed scope: ${
      details.length > 0 ? details.join("; ") : "(no explicit repo paths, urls, or domains)"
    }`;
  }

  const outputHint =
    input.expectedOutput === "patch"
      ? "Return concise implementation notes and mention the files changed."
      : input.expectedOutput === "citations"
        ? "Return concise findings with explicit file or URL citations."
        : input.expectedOutput === "findings"
          ? "Return concise findings in bullet form."
          : "Return a concise summary with actionable findings and citations when relevant.";

  return [
    "You are a delegated xeq subagent.",
    `Kind: ${input.kind}`,
    scopeDetails,
    `Task: ${input.prompt}`,
    outputHint,
    "Stay within the stated scope.",
    "Prefer concise, directly useful output.",
    "If you use files or URLs, cite them inline in your response.",
  ].join("\n");
}

export function createSpawnSubagentExecutor(options: SpawnSubagentExecutorOptions) {
  const model = resolveModel(options.modelId);

  return async function spawnSubagent(input: SpawnSubagentInput): Promise<SpawnSubagentResult> {
    const startedAt = Date.now();
    const parentTurnId = input.parentTurnId?.trim() || options.parentSessionId;
    const childSessionId = sanitizeId(
      input.resumeKey?.trim() ||
        `${options.parentSessionId}:subagent:${input.name ?? input.kind}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    );

    if (input.scope.type === "web" && !options.providers.web) {
      return {
        subagentId: childSessionId,
        status: "failed",
        summary: "Web subagents are unavailable because no web provider is configured.",
        findings: ["No web provider was configured for this runtime."],
        citations: [],
        artifacts: [],
        trace: {
          parentTurnId,
          childTurnId: childSessionId,
          kind: input.kind,
          startedAt: toIsoString(startedAt),
          finishedAt: toIsoString(Date.now()),
        },
      };
    }

    const trackedFs = createTrackedFsProvider(options.providers.fs, childSessionId);
    const childTools = buildChildToolSet(
      input,
      {
        ...options.providers,
        fs: trackedFs,
      },
      options.approvePatchApply,
    );

    const childAgent = new Agent({
      name: input.name?.trim() || `xeq-${input.kind}`,
      description:
        input.kind === "research"
          ? "Delegated research subagent"
          : input.kind === "verify"
            ? "Delegated verification subagent"
            : input.kind === "implement"
              ? "Delegated implementation subagent"
              : "Delegated subagent",
      model: model.model,
      systemPrompt: buildChildSystemPrompt(input, options.cwd),
      tools: childTools,
      maxSteps: input.maxSteps ?? DEFAULT_MAX_STEPS,
      instructions: options.runtimeConfig?.projectInstructions ?? true,
      approve: async (toolCall) => {
        return options.approveToolCall ? options.approveToolCall(toolCall) : true;
      },
    });

    const session = new Session({
      agent: childAgent,
      contextWindow: 100_000,
      sessionId: childSessionId,
      sessionStore: {
        load: async (id: string) => loadEffectiveModelMessages(id),
        save: async (id: string, messages: ModelMessage[]) => {
          await replaceMessages(id, messages);
        },
      },
    });

    await session.load();

    let finalText = "";
    try {
      for await (const event of session.send(input.prompt)) {
        if (event.type === "text.delta") {
          finalText += event.text;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await childAgent.close();
      return {
        subagentId: childSessionId,
        status: "failed",
        summary: message,
        findings: [message],
        citations: [],
        artifacts: [],
        trace: {
          parentTurnId,
          childTurnId: childSessionId,
          kind: input.kind,
          startedAt: toIsoString(startedAt),
          finishedAt: toIsoString(Date.now()),
        },
      };
    }

    const assistantMessages = [...session.messages].filter((message) => message.role === "assistant");
    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    const assistantText = lastAssistant ? modelMessageToText(lastAssistant.content) : "";
    const summary = assistantText.trim() || finalText.trim() || "Subagent completed.";
    const findings = extractFindings(summary);
    const citations = extractCitations(summary);
    await childAgent.close();

    return {
      subagentId: childSessionId,
      status: "completed",
      summary,
      findings,
      citations,
      artifacts: [],
      trace: {
        parentTurnId,
        childTurnId: childSessionId,
        kind: input.kind,
        startedAt: toIsoString(startedAt),
        finishedAt: toIsoString(Date.now()),
      },
    };
  };
}
