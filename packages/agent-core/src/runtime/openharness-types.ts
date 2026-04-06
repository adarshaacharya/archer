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
