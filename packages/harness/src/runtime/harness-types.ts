import type {
  HarnessFsProvider,
  HarnessRuntimeConfig,
  HarnessShellProvider,
  HarnessToolCallInfo,
} from "@archer/shared/runtime";
import type { WebCapability } from "@archer/tools";

export interface HarnessRuntimeStepEvent {
  step: number;
  action: string;
  thought?: string;
  observation?: string;
}

export type HarnessToolEvent =
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

export type HarnessUsageEvent = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type RuntimeProviders = {
  fs: HarnessFsProvider;
  shell: HarnessShellProvider;
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

export interface HarnessRuntimeDeps {
  modelId?: string;
  instructions?: string;
  runtimeConfig?: HarnessRuntimeConfig;
  onStep?: (event: HarnessRuntimeStepEvent) => void;
  onToolEvent?: (event: HarnessToolEvent) => void;
  onTextDelta?: (delta: string) => void;
  approveToolCall?: (toolCall: HarnessToolCallInfo) => Promise<boolean> | boolean;
  approvePatchApply?: (preview: PatchPreview) => Promise<boolean> | boolean;
  onUsage?: (usage: HarnessUsageEvent, replace?: boolean) => void;
  sessionId?: string;
  providers: RuntimeProviders;
}
