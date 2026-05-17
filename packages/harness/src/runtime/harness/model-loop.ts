import type { HarnessModelDecision, HarnessTurnRequest } from "./contracts.js";

export type HarnessLoopState = {
  prompt: string;
  observations: Array<{
    step: number;
    kind: "tool_result";
    toolName: string;
    output: unknown;
  }>;
};

export interface HarnessModelLoop {
  decide(params: {
    request: HarnessTurnRequest;
    state: HarnessLoopState;
    step: number;
  }): Promise<HarnessModelDecision>;
}
