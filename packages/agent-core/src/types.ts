export type RunStatus = "running" | "completed" | "failed" | "cancelled" | "timed_out";

export interface RunContext {
  runId: string;
  startedAt: number;
  cwd: string;
  maxSteps: number;
  step: number;
}

export interface AgentState {
  messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>;
  lastToolResult?: ToolResult;
}

export interface ToolCall {
  name: string;
  input: unknown;
}

export interface ToolResult {
  ok: boolean;
  output?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface RunResult {
  status: RunStatus;
  steps: number;
  outputText: string;
  error?: string;
}

export type ModelDecision = { type: "final"; text: string } | { type: "tool_call"; call: ToolCall };

export interface RunOptions {
  cwd: string;
  maxSteps?: number;
  timeoutMs?: number;
}

export const DEFAULT_MAX_STEPS = 20;
export const DEFAULT_TIMEOUT_MS = 120_000;
