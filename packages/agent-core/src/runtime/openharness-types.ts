import type { FsProvider, ShellProvider, ToolCallInfo } from "@openharness/core";
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
  patchId?: string;
  bundleId?: string;
  filePath: string;
  diff: string;
  summary?: string;
  changedFilesCount?: number;
  files?: Array<{
    filePath: string;
    diff: string;
    status?: string;
  }>;
};

export interface OpenHarnessRuntimeDeps {
  modelId?: string;
  instructions?: string;
  onStep?: (event: OpenHarnessRuntimeStepEvent) => void;
  onTextDelta?: (delta: string) => void;
  approveToolCall?: (toolCall: ToolCallInfo) => Promise<boolean> | boolean;
  approvePatchApply?: (preview: PatchPreview) => Promise<boolean> | boolean;
  sessionId?: string;
  providers: RuntimeProviders;
}
