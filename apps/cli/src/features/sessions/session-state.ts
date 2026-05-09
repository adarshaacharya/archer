import type { SupportedProvider } from "@archer/model-providers";
import type { OpenHarnessRuntimeConfig } from "@archer/shared/runtime";
import type { ApprovalMode } from "@archer/shared/approval";
import type { SupportedWebProvider } from "@archer/web-capability";

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
