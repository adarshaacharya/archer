import type { ApprovalMode } from "@archer/shared";
import type { OpenHarnessRuntimeConfig } from "@archer/shared";
import type { SupportedProvider } from "@archer/model-providers";
import type { SupportedWebProvider } from "@archer/web";

export type SessionState = {
  sessionId: string;
  sessionTitle: string | null;
  projectRoot: string;
  approvalMode: ApprovalMode;
  provider: SupportedProvider | null;
  modelId: string;
  authSource: "env" | "saved" | null;
  webProvider: SupportedWebProvider | null;
  webAuthSource: "env" | "saved" | null;
  openHarnessConfig: OpenHarnessRuntimeConfig;
};
