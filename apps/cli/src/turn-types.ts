import type { InputIntent } from "./intent-router.js";

export type TurnIntent = Exclude<InputIntent, "ambiguous">;

export type TurnStatus = "completed" | "failed" | "cancelled" | "clarify";

export interface TurnContext {
  sessionId: string;
  task: string;
  intent: TurnIntent;
  projectRoot: string;
  approvalMode: string;
  modelId: string;
  startedAt: number;
}

export interface TurnSummary {
  success: boolean;
  steps: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  evalMetrics?: {
    approvalCount: number;
    fileReadCount: number;
    changedPaths: string[];
    toolNames: string[];
    finalMessage: string;
  };
}

export interface TurnResult {
  status: TurnStatus;
  intent: InputIntent;
  task: string;
  summary?: TurnSummary;
  message?: string;
}
