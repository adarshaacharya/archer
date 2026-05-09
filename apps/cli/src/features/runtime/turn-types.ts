import type { InputIntent } from "../routing/intent-router.js";

export type TurnStatus = "completed" | "failed" | "cancelled" | "clarify";

export interface TurnContext {
  sessionId: string;
  task: string;
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
  compaction?: {
    policy: {
      protectTokens: number;
      prunableTokens: number;
    };
    attempted: boolean;
    attempts: number;
    trigger: "context-pressure" | null;
    status: "not-needed" | "succeeded" | "failed";
    report: {
      summary: string;
      criticalFiles: string[];
      openRisks: string[];
    } | null;
  };
  evalMetrics?: {
    approvalCount: number;
    fileReadCount: number;
    changedPaths: string[];
    toolNames: string[];
    webEventCount: number;
    webQueries: string[];
    webUrls: string[];
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
