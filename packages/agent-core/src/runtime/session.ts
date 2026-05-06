import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveModelConfig } from "@archer/model-providers";
import { loadEffectiveModelMessages, replaceMessages } from "@archer/storage";
import {
  createEditTools,
  createSpawnSubagentTool,
  createSubagentAwaitTool,
  createSubagentCancelTool,
  createSubagentStatusTool,
  createSubmitCompactionReportTool,
  createSubmitPlanTool,
  createSubmitTurnDecisionTool,
  createSubmitVerificationReportTool,
  createWebFindInPageTool,
  createWebOpenPageTool,
  createWebSearchTool,
} from "@archer/tools";
import { Agent, AgentRegistry, createFsTools, createLocalTools, Session } from "@openharness/core";
import type { ModelMessage } from "ai";
import { DEFAULT_MAX_STEPS } from "../types.js";
import { createTrackedFsProvider } from "./file-tracker.js";
import { sanitizeId } from "./ids.js";
import { resolveModel } from "./model.js";
import type { OpenHarnessRuntimeDeps, RuntimeProviders } from "./openharness-types.js";
import { createSpawnSubagentExecutor } from "./subagent-execution.js";
import { buildSystemPrompt } from "./task-flow.js";

type RuntimeSession = {
  session: Session;
  cwd: string;
  provider: string;
  modelId: string;
  pricing?: ReturnType<typeof resolveModel>["pricing"];
  loaded: boolean;
  approvalState: {
    approveToolCall?: OpenHarnessRuntimeDeps["approveToolCall"];
    approvePatchApply?: OpenHarnessRuntimeDeps["approvePatchApply"];
  };
};

const SESSIONS = new Map<string, RuntimeSession>();

function resolveSkillPaths(
  cwd: string,
  configuredPaths: string[] | undefined,
): string[] | undefined {
  const paths = new Set<string>();
  const candidates = [
    resolve(cwd, ".agents/skills"),
    resolve(cwd, ".claude/skills"),
    resolve(cwd, "skills"),
    ...(configuredPaths ?? []).map((path) => resolve(cwd, path)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      paths.add(candidate);
    }
  }

  return paths.size > 0 ? [...paths] : undefined;
}

function createSession({
  cwd,
  providers,
  modelId,
  instructions,
  runtimeConfig,
  approveToolCall,
  approvePatchApply,
  sessionId,
}: {
  cwd: string;
  providers: RuntimeProviders;
  modelId?: string;
  instructions?: string;
  runtimeConfig?: OpenHarnessRuntimeDeps["runtimeConfig"];
  approveToolCall?: OpenHarnessRuntimeDeps["approveToolCall"];
  approvePatchApply?: OpenHarnessRuntimeDeps["approvePatchApply"];
  sessionId?: string;
}): RuntimeSession {
  const model = resolveModel(modelId);
  const trackedFs = createTrackedFsProvider(providers.fs, sessionId ?? `${cwd}:${model.modelId}`);
  const skillPaths = resolveSkillPaths(cwd, runtimeConfig?.skills?.paths);
  const approvalState: RuntimeSession["approvalState"] = {
    approveToolCall,
    approvePatchApply,
  };
  const backgroundRegistry =
    runtimeConfig?.subagents?.enabled === false
      ? undefined
      : new AgentRegistry({
          maxConcurrent: 8,
          timeout: undefined,
          autoCancel: true,
          tools: {
            status: true,
            cancel: true,
            await: ["all", "allSettled", "any", "race"],
          },
        });
  const backgroundRegistryLike = backgroundRegistry
    ? {
        getStatus(subagentId: string) {
          const status = backgroundRegistry.getStatus(subagentId);
          return status ? { subagentId, ...status } : undefined;
        },
        cancel(subagentId: string) {
          return backgroundRegistry.cancel(subagentId);
        },
        async awaitAll(subagentIds: string[]) {
          return backgroundRegistry.awaitAll(subagentIds);
        },
        async awaitAllSettled(subagentIds: string[]) {
          return new Map(
            [...(await backgroundRegistry.awaitAllSettled(subagentIds)).entries()].map(
              ([subagentId, result]) => [
                subagentId,
                {
                  subagentId,
                  status: result.status,
                  sessionId: result.sessionId,
                  result: result.result,
                  error: result.error,
                },
              ],
            ),
          );
        },
        async awaitAny(subagentIds: string[]) {
          const result = await backgroundRegistry.awaitAny(subagentIds);
          return {
            id: result.id,
            sessionId: result.sessionId,
            result: result.result,
          };
        },
        async awaitRace(subagentIds: string[]) {
          const result = await backgroundRegistry.awaitRace(subagentIds);
          return {
            id: result.id,
            sessionId: result.sessionId,
            result: result.result,
            error: result.error,
          };
        },
      }
    : undefined;
  const readOnlyFsTools = createFsTools(trackedFs);
  const explorerTools = {
    readFile: readOnlyFsTools.readFile,
    listFiles: readOnlyFsTools.listFiles,
    grep: readOnlyFsTools.grep,
  };
  const subagents =
    runtimeConfig?.subagents?.enabled === false
      ? undefined
      : [
          new Agent({
            name: "repo-explorer",
            description: "Read-only repository exploration subagent.",
            model: model.model,
            systemPrompt:
              "You are Archer's repository exploration subagent. Read files, list directories, and grep for symbols. Do not edit files or run shell commands. Return concise findings with exact file references.",
            tools: explorerTools,
            maxSteps: 12,
            instructions: runtimeConfig?.projectInstructions ?? true,
            approve: async (toolCall) => {
              return approvalState.approveToolCall ? approvalState.approveToolCall(toolCall) : true;
            },
          }),
          ...(providers.web
            ? [
                new Agent({
                  name: "web-research",
                  description: "External web research subagent.",
                  model: model.model,
                  systemPrompt:
                    "You are Archer's web research subagent. Use web tools to inspect external sources and answer from those sources only. Do not inspect local repository files.",
                  tools: {
                    webFindInPage: createWebFindInPageTool(providers.web),
                    webOpenPage: createWebOpenPageTool(providers.web),
                    webSearch: createWebSearchTool(providers.web),
                  },
                  maxSteps: 12,
                  instructions: runtimeConfig?.projectInstructions ?? true,
                  approve: async (toolCall) => {
                    return approvalState.approveToolCall
                      ? approvalState.approveToolCall(toolCall)
                      : true;
                  },
                }),
              ]
            : []),
        ];
  const editTools = createEditTools(trackedFs, {
    onPatchPreview: async (preview) => {
      if (!approvalState.approvePatchApply) {
        return true;
      }

      return approvalState.approvePatchApply(
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
  const spawnSubagent = createSpawnSubagentExecutor({
    cwd,
    parentSessionId: sanitizeId(sessionId ?? `${cwd}:${model.modelId}`),
    providers: {
      ...providers,
      fs: trackedFs,
    },
    runtimeConfig,
    modelId: model.modelId,
    approveToolCall,
    approvePatchApply,
    backgroundRegistry,
  });
  const tools = {
    ...createLocalTools({ fs: trackedFs, shell: providers.shell }),
    submitCompactionReport: createSubmitCompactionReportTool(),
    submitTurnDecision: createSubmitTurnDecisionTool(),
    submitPlan: createSubmitPlanTool(),
    submitVerificationReport: createSubmitVerificationReportTool(),
    ...(runtimeConfig?.subagents?.enabled === false || !backgroundRegistryLike
      ? {}
      : {
          spawnSubagent: createSpawnSubagentTool(spawnSubagent),
          subagentStatus: createSubagentStatusTool(backgroundRegistryLike),
          subagentCancel: createSubagentCancelTool(backgroundRegistryLike),
          subagentAwait: createSubagentAwaitTool(backgroundRegistryLike),
        }),
    createDirectory: editTools.createDirectory,
    preparePatchBundle: editTools.preparePatchBundle,
    preparePatch: editTools.preparePatch,
    ...(providers.web
      ? {
          webFindInPage: createWebFindInPageTool(providers.web),
          webOpenPage: createWebOpenPageTool(providers.web),
          webSearch: createWebSearchTool(providers.web),
        }
      : {}),
  };

  const agent = new Agent({
    name: "archer",
    description: "Archer terminal coding agent",
    model: model.model,
    systemPrompt: instructions ?? buildSystemPrompt(),
    instructions: runtimeConfig?.projectInstructions ?? true,
    maxSteps: DEFAULT_MAX_STEPS,
    tools,
    subagents,
    mcpServers: runtimeConfig?.mcpServers,
    skills: skillPaths ? { paths: skillPaths } : undefined,
    approve: async (toolCall) => {
      return approvalState.approveToolCall ? approvalState.approveToolCall(toolCall) : true;
    },
  });

  const session = new Session({
    agent,
    contextWindow: 200_000,
    sessionId: sessionId ? sanitizeId(sessionId) : undefined,
    sessionStore: {
      load: async (id: string) => loadEffectiveModelMessages(id),
      save: async (id: string, messages: ModelMessage[]) => {
        await replaceMessages(id, messages);
      },
    },
  });

  return {
    session,
    cwd,
    provider: model.provider,
    modelId: model.modelId,
    pricing: model.pricing,
    loaded: false,
    approvalState,
  };
}

export function getOrCreateSession({
  cwd,
  providers,
  modelId,
  instructions,
  approveToolCall,
  approvePatchApply,
  sessionId,
}: {
  cwd: string;
  providers: RuntimeProviders;
  modelId?: string;
  instructions?: string;
  approveToolCall?: OpenHarnessRuntimeDeps["approveToolCall"];
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
    existing.approvalState.approveToolCall = approveToolCall;
    existing.approvalState.approvePatchApply = approvePatchApply;
    return existing;
  }

  const created = createSession({
    cwd,
    providers,
    modelId: resolved.modelId,
    instructions,
    approveToolCall,
    approvePatchApply,
    sessionId: key,
  });
  SESSIONS.set(key, created);
  return created;
}

export function resetSessionById(sessionId: string): void {
  const key = sanitizeId(sessionId);
  SESSIONS.delete(key);
}
