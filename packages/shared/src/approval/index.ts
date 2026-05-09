import { z } from "zod";

export const ApprovalModeSchema = z.enum(["read-only", "workspace-write", "danger-full-access"]);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

const LEGACY_APPROVAL_MODE_ALIASES = {
  suggest: "workspace-write",
  "auto-edit": "danger-full-access",
} as const satisfies Record<string, ApprovalMode>;

export function normalizeApprovalMode(value: string): ApprovalMode | null {
  const normalized = value.trim().toLowerCase();
  if (normalized in LEGACY_APPROVAL_MODE_ALIASES) {
    return LEGACY_APPROVAL_MODE_ALIASES[normalized as keyof typeof LEGACY_APPROVAL_MODE_ALIASES];
  }

  const parsed = ApprovalModeSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

export function canWriteInApprovalMode(mode: ApprovalMode): boolean {
  return mode !== "read-only";
}

export function autoApproveEditsInApprovalMode(mode: ApprovalMode): boolean {
  return mode === "danger-full-access";
}

export function autoApproveCommandsInApprovalMode(mode: ApprovalMode): boolean {
  return mode === "danger-full-access";
}
