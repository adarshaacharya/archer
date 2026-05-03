import type { ApprovalMode } from "@xeq/shared";
import type { OpenHarnessRuntimeConfig } from "@xeq/shared";
import type { SupportedProvider } from "@xeq/model-providers";
import type { SupportedWebProvider } from "@xeq/web";

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
