export type RuntimePhaseUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

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
};

export type RuntimePhaseRunner = (
  prompt: string,
  persistTranscript: boolean,
  maxSteps: number,
  options?: RuntimePhaseOptions,
) => Promise<RuntimePhaseResult>;
