import type { OpenHarnessRuntimeConfig } from "@archer/shared/runtime";
import type { WebCapability } from "@archer/tools";
import type { FsProvider, ShellProvider, ToolCallInfo } from "@openharness/core";

export interface OpenHarnessRuntimeStepEvent {
  step: number;
  action: string;
  thought?: string;
  observation?: string;
}

export type OpenHarnessToolEvent =
  | {
      phase: "start";
      step: number;
      toolName: string;
    }
  | {
      phase: "done";
      step: number;
      toolName: string;
      output: unknown;
    }
  | {
      phase: "error";
      step: number;
      toolName: string;
      error: string;
    };

export type OpenHarnessUsageEvent = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type RuntimeProviders = {
  fs: FsProvider;
  shell: ShellProvider;
  web?: WebCapability;
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
  runtimeConfig?: OpenHarnessRuntimeConfig;
  onStep?: (event: OpenHarnessRuntimeStepEvent) => void;
  onToolEvent?: (event: OpenHarnessToolEvent) => void;
  onTextDelta?: (delta: string) => void;
  approveToolCall?: (toolCall: ToolCallInfo) => Promise<boolean> | boolean;
  approvePatchApply?: (preview: PatchPreview) => Promise<boolean> | boolean;
  onUsage?: (usage: OpenHarnessUsageEvent, replace?: boolean) => void;
  sessionId?: string;
  providers: RuntimeProviders;
}
