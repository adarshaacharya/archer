export type RuntimePhaseUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

import type { HarnessToolEvent } from "./harness-types.js";

export type RuntimePhaseResult = {
  status: string;
  steps: number;
  outputText: string;
  error?: string;
  usage?: RuntimePhaseUsage;
  estimatedCostUsd?: number;
};

export type RuntimePhaseOptions = {
  allowTools?: boolean;
  allowedToolNames?: string[];
  instructions?: string;
  onToolEvent?: (event: HarnessToolEvent) => void;
};

export type RuntimePhaseRunner = (
  prompt: string,
  persistTranscript: boolean,
  maxSteps: number,
  options?: RuntimePhaseOptions,
) => Promise<RuntimePhaseResult>;
