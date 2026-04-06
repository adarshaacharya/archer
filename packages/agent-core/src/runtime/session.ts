import { Agent, NodeFsProvider, NodeShellProvider, Session, createLocalTools } from "@openharness/core";
import { DEFAULT_MAX_STEPS } from "../types.js";
import { sanitizeId } from "./ids.js";
import { resolveModel } from "./model.js";

type RuntimeSession = {
  session: Session;
  cwd: string;
  modelId: string;
};

const SESSIONS = new Map<string, RuntimeSession>();

function createSession(cwd: string, modelId?: string, instructions?: string, sessionId?: string): RuntimeSession {
  const model = resolveModel(modelId);
  const fs = new NodeFsProvider({ cwd });
  const shell = new NodeShellProvider({ cwd });
  const tools = createLocalTools({ fs, shell });

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
      if (toolCall.toolName === "bash" && process.env.XEQ_REQUIRE_COMMAND_APPROVAL === "true") {
        return false;
      }
      return true;
    },
  });

  const session = new Session({
    agent,
    contextWindow: 200_000,
    sessionId: sessionId ? sanitizeId(sessionId) : undefined,
  });

  return { session, cwd, modelId: model.id };
}

export function getOrCreateSession(
  cwd: string,
  modelId?: string,
  instructions?: string,
  sessionId?: string,
): RuntimeSession {
  const key = sanitizeId(sessionId ?? `${cwd}:${modelId ?? ""}`);
  const currentModel = modelId ?? process.env.AGENT_MODEL ?? "openai/gpt-4o-mini";
  const existing = SESSIONS.get(key);
  if (existing && existing.cwd === cwd && existing.modelId === currentModel) {
    return existing;
  }

  const created = createSession(cwd, currentModel, instructions, key);
  SESSIONS.set(key, created);
  return created;
}
