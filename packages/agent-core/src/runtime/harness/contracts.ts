export type HarnessTurnMode = "plan" | "change" | "answer" | "review" | "compact";

export type HarnessTurnStatus =
  | "idle"
  | "running"
  | "awaiting_approval"
  | "cancelled"
  | "failed"
  | "completed";

export type HarnessEvent =
  | { type: "turn.started"; turnId: string; mode: HarnessTurnMode }
  | { type: "turn.progress"; turnId: string; step: number; action: string; detail?: string }
  | { type: "turn.awaiting_approval"; turnId: string; reason: string }
  | { type: "turn.cancelled"; turnId: string; reason?: string }
  | { type: "turn.failed"; turnId: string; error: string }
  | { type: "turn.completed"; turnId: string; outputText: string; steps: number };

export type HarnessTurnRequest = {
  turnId: string;
  sessionId: string;
  mode: HarnessTurnMode;
  prompt: string;
  cwd: string;
  maxSteps: number;
  timeoutMs: number;
};

export type HarnessTurnResult = {
  status: Extract<HarnessTurnStatus, "cancelled" | "failed" | "completed">;
  outputText: string;
  steps: number;
  error?: string;
};

export type HarnessModelDecision =
  | { type: "final"; text: string }
  | { type: "tool_call"; toolName: string; args: unknown };
