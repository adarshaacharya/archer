import type { FsProvider, ShellProvider } from "@openharness/core";
import type { WebSearchProvider } from "@xeq/tools";

export interface OpenHarnessRuntimeStepEvent {
  step: number;
  action: string;
  thought?: string;
  observation?: string;
}

export type RuntimeProviders = {
  fs: FsProvider;
  shell: ShellProvider;
  webSearch?: WebSearchProvider;
};

export interface OpenHarnessRuntimeDeps {
  modelId?: string;
  instructions?: string;
  onStep?: (event: OpenHarnessRuntimeStepEvent) => void;
  sessionId?: string;
  providers: RuntimeProviders;
}
