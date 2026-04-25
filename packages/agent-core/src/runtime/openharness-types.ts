import type { FsProvider, ShellProvider } from "@openharness/core";

export interface OpenHarnessRuntimeStepEvent {
  step: number;
  action: string;
  thought?: string;
  observation?: string;
}

export type RuntimeProviders = {
  fs: FsProvider;
  shell: ShellProvider;
};

export interface OpenHarnessRuntimeDeps {
  modelId?: string;
  instructions?: string;
  onStep?: (event: OpenHarnessRuntimeStepEvent) => void;
  sessionId?: string;
  providers: RuntimeProviders;
}
