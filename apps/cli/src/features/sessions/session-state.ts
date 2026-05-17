import type { SupportedProvider } from "@archer/model-providers";
import type { ApprovalMode } from "@archer/shared/approval";
import type { HarnessRuntimeConfig } from "@archer/shared/runtime";
import type { SupportedWebProvider } from "../../../../../packages/web-capability/src/index.js";

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
  harnessConfig: HarnessRuntimeConfig;
};
