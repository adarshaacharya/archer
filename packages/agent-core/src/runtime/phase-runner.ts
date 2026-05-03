export type RuntimePhaseUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

import type { OpenHarnessToolEvent } from "./openharness-types.js";

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
  instructions?: string;
  onToolEvent?: (event: OpenHarnessToolEvent) => void;
};

export type RuntimePhaseRunner = (
  prompt: string,
  persistTranscript: boolean,
  maxSteps: number,
  options?: RuntimePhaseOptions,
) => Promise<RuntimePhaseResult>;
