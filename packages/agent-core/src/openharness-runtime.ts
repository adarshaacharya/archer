import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  Agent,
  NodeFsProvider,
  NodeShellProvider,
  Session,
  createLocalTools,
  type SessionEvent,
} from "@openharness/core";
import { DEFAULT_MAX_STEPS, DEFAULT_TIMEOUT_MS, type RunOptions, type RunResult } from "./types.js";

export interface OpenHarnessRuntimeStepEvent {
  step: number;
  action: string;
  thought?: string;
  observation?: string;
}

export interface OpenHarnessRuntimeDeps {
  modelId?: string;
  instructions?: string;
  onStep?: (event: OpenHarnessRuntimeStepEvent) => void;
  sessionId?: string;
}

type RuntimeSession = {
  session: Session;
  cwd: string;
  modelId: string;
};

const SESSIONS = new Map<string, RuntimeSession>();

function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`run timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function resolveModel(modelId?: string) {
  const id = modelId ?? process.env.AGENT_MODEL ?? "openai/gpt-4o-mini";
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for OpenHarness runtime");
  }
  const openrouter = createOpenRouter({ apiKey });
  return {
    id,
    model: openrouter.chat(id),
  };
}

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

function getOrCreateSession(
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

export async function runOpenHarnessRuntime(
  deps: OpenHarnessRuntimeDeps,
  prompt: string,
  options: RunOptions,
): Promise<RunResult> {
  const runId = newRunId();
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sessionKey = deps.sessionId ? sanitizeId(deps.sessionId) : runId;
  const runtime = getOrCreateSession(options.cwd, deps.modelId, deps.instructions, sessionKey);
  let stepCounter = 0;
  let finalText = "";

  deps.onStep?.({
    step: 1,
    action: "model.generate",
    thought: "thinking",
    observation: "starting (openharness)",
  });

  const run = async () => {
    for await (const event of runtime.session.send(prompt)) {
      mapEvent(event, deps.onStep, ++stepCounter, (text) => {
        finalText += text;
      });
    }
  };

  try {
    await withTimeout(run(), timeoutMs);
    const text = finalText.trim() || "Task complete";
    deps.onStep?.({
      step: Math.max(1, stepCounter + 1),
      action: "model.final",
      thought: "completed",
      observation: text,
    });
    return {
      status: "completed",
      steps: Math.max(1, Math.min(stepCounter + 1, maxSteps + 2)),
      outputText: text,
    };
  } catch (error) {
    return {
      status: "failed",
      steps: Math.max(1, stepCounter),
      outputText: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function mapEvent(
  event: SessionEvent,
  onStep: OpenHarnessRuntimeDeps["onStep"],
  step: number,
  onText: (delta: string) => void,
): void {
  if (!onStep) return;

  switch (event.type) {
    case "text.delta":
      onText(event.text);
      break;
    case "reasoning.delta":
      onStep({ step, action: "model.reasoning", observation: event.text });
      break;
    case "tool.start":
      onStep({ step, action: `tool.${event.toolName}`, observation: "started" });
      break;
    case "tool.done":
      onStep({ step, action: `tool.${event.toolName}`, observation: "completed" });
      break;
    case "tool.error":
      onStep({ step, action: `tool.${event.toolName}`, observation: event.error });
      break;
    case "error":
      onStep({ step, action: "run.error", observation: event.error.message });
      break;
    default:
      break;
  }
}
