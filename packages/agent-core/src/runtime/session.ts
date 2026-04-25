import { Agent, Session, createLocalTools } from "@openharness/core";
import { resolveModelConfig } from "@xeq/model-providers";
import { createEditTools, createWebFetchTool, createWebSearchTool } from "@xeq/tools";
import { DEFAULT_MAX_STEPS } from "../types.js";
import { sanitizeId } from "./ids.js";
import { resolveModel } from "./model.js";
import type { OpenHarnessRuntimeDeps, RuntimeProviders } from "./openharness-types.js";

type RuntimeSession = {
  session: Session;
  cwd: string;
  provider: string;
  modelId: string;
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
      "You are XEQ, a terminal coding agent. Make minimal safe edits and use tools deliberately. Prefer preparePatchBundle for multi-file changes and preparePatch for single-file changes. These tools show a reviewable diff and apply the change immediately when approved.",
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
  });

  return { session, cwd, provider: model.provider, modelId: model.modelId };
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
