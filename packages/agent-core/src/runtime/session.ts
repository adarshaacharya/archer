import { Agent, Session, createLocalTools } from "@openharness/core";
import { resolveModelConfig } from "@xeq/model-providers";
import { DEFAULT_MAX_STEPS } from "../types.js";
import { sanitizeId } from "./ids.js";
import { resolveModel } from "./model.js";
import type { RuntimeProviders } from "./openharness-types.js";

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
  sessionId,
}: {
  cwd: string;
  providers: RuntimeProviders;
  modelId?: string;
  instructions?: string;
  sessionId?: string;
}): RuntimeSession {
  const model = resolveModel(modelId);
  const tools = createLocalTools({ fs: providers.fs, shell: providers.shell });

  const agent = new Agent({
    name: "xeq",
    description: "XEQ terminal coding agent",
    model: model.model,
    systemPrompt:
      instructions ??
      "You are XEQ, a terminal coding agent. Make minimal safe edits and use tools deliberately.",
    maxSteps: DEFAULT_MAX_STEPS,
    tools,
    approve: (toolCall) => {
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
  sessionId,
}: {
  cwd: string;
  providers: RuntimeProviders;
  modelId?: string;
  instructions?: string;
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
    sessionId: key,
  });
  SESSIONS.set(key, created);
  return created;
}
