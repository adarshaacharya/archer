import { Agent, Session, createLocalTools } from "@openharness/core";
import { resolveModelConfig } from "@xeq/model-providers";
import { loadModelMessages, replaceMessages } from "@xeq/storage";
import { createEditTools, createWebFetchTool, createWebSearchTool } from "@xeq/tools";
import type { ModelMessage } from "ai";
import { DEFAULT_MAX_STEPS } from "../types.js";
import { sanitizeId } from "./ids.js";
import { resolveModel } from "./model.js";
import type { OpenHarnessRuntimeDeps, RuntimeProviders } from "./openharness-types.js";

type RuntimeSession = {
  session: Session;
  cwd: string;
  provider: string;
  modelId: string;
  loaded: boolean;
};

const SESSIONS = new Map<string, RuntimeSession>();

function createSession({
  cwd,
  providers,
  modelId,
  instructions,
  approvePatchApply,
  sessionId,
}: {
  cwd: string;
  providers: RuntimeProviders;
  modelId?: string;
  instructions?: string;
  approvePatchApply?: OpenHarnessRuntimeDeps["approvePatchApply"];
  sessionId?: string;
}): RuntimeSession {
  const model = resolveModel(modelId);
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
  const tools = {
    ...createLocalTools({ fs: providers.fs, shell: providers.shell }),
    preparePatchBundle: editTools.preparePatchBundle,
    preparePatch: editTools.preparePatch,
    ...(providers.webSearch
      ? {
          webFetch: createWebFetchTool(providers.webSearch),
          webSearch: createWebSearchTool(providers.webSearch),
        }
      : {}),
  };

  const agent = new Agent({
    name: "xeq",
    description: "XEQ terminal coding agent",
    model: model.model,
    systemPrompt:
      instructions ??
      [
        "You are XEQ, a terminal coding agent.",
        "Default to doing the work without asking questions. Treat short tasks as sufficient direction and infer missing details by reading the codebase and following existing conventions.",
        "Only ask when you are truly blocked after checking relevant context and cannot safely pick a reasonable default.",
        "This usually means the request is ambiguous in a way that materially changes the result, the action is destructive or security-sensitive, or you need a secret or value that cannot be inferred.",
        "If you must ask, do all non-blocked work first, ask exactly one targeted question, include your recommended default, and say what changes based on the answer.",
        "Never ask permission questions like 'Should I proceed?' or 'Do you want me to run tests?'; proceed with the most reasonable option and mention what you did.",
        "Make minimal safe edits and use tools deliberately.",
        "Prefer preparePatchBundle for multi-file changes and preparePatch for single-file changes.",
        "These tools show a reviewable diff and apply the change immediately when approved.",
      ].join(" "),
    maxSteps: DEFAULT_MAX_STEPS,
    tools,
    approve: async (toolCall) => {
      // if (toolCall.toolName === "bash") {
      //   return false;
      // }
      return true;
    },
  });

  const session = new Session({
    agent,
    contextWindow: 200_000,
    sessionId: sessionId ? sanitizeId(sessionId) : undefined,
    sessionStore: {
      load: async (id: string) => loadModelMessages(id),
      save: async (id: string, messages: ModelMessage[]) => {
        await replaceMessages(id, messages);
      },
    },
  });

  return { session, cwd, provider: model.provider, modelId: model.modelId, loaded: false };
}

export function getOrCreateSession({
  cwd,
  providers,
  modelId,
  instructions,
  approvePatchApply,
  sessionId,
}: {
  cwd: string;
  providers: RuntimeProviders;
  modelId?: string;
  instructions?: string;
  approvePatchApply?: OpenHarnessRuntimeDeps["approvePatchApply"];
  sessionId?: string;
}): RuntimeSession {
  const resolved = resolveModelConfig({ modelId });
  const key = sanitizeId(sessionId ?? `${cwd}:${resolved.provider}:${resolved.modelId}`);
  const existing = SESSIONS.get(key);
  if (
    existing &&
    existing.cwd === cwd &&
    existing.provider === resolved.provider &&
    existing.modelId === resolved.modelId
  ) {
    return existing;
  }

  const created = createSession({
    cwd,
    providers,
    modelId: resolved.modelId,
    instructions,
    approvePatchApply,
    sessionId: key,
  });
  SESSIONS.set(key, created);
  return created;
}
