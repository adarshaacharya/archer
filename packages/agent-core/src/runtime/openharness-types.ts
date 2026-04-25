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

export type PatchPreview = {
  patchId: string;
  filePath: string;
  diff: string;
};

export interface OpenHarnessRuntimeDeps {
  modelId?: string;
  instructions?: string;
  onStep?: (event: OpenHarnessRuntimeStepEvent) => void;
  onTextDelta?: (delta: string) => void;
  approvePatchApply?: (preview: PatchPreview) => Promise<boolean> | boolean;
  sessionId?: string;
  providers: RuntimeProviders;
}
