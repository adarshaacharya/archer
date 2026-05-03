import { z } from "zod";

export const ApprovalModeSchema = z.enum([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
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

export const ComposerTextElementSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  kind: z.enum(["mention", "image-placeholder", "attachment-placeholder"]),
  display: z.string().min(1).optional(),
  bindingId: z.string().min(1).optional(),
});
export type ComposerTextElement = z.infer<typeof ComposerTextElementSchema>;

export const ComposerMentionTargetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file"),
    path: z.string().min(1),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("skill"),
    path: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal("resource"),
    uri: z.string().min(1),
    name: z.string().min(1),
  }),
]);
export type ComposerMentionTarget = z.infer<typeof ComposerMentionTargetSchema>;

export const ComposerMentionBindingSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  target: ComposerMentionTargetSchema,
});
export type ComposerMentionBinding = z.infer<typeof ComposerMentionBindingSchema>;

export const ComposerAttachmentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("local-image"),
    path: z.string().min(1),
  }),
]);
export type ComposerAttachment = z.infer<typeof ComposerAttachmentSchema>;

export const ComposerSubmissionSchema = z.object({
  text: z.string(),
  textElements: z.array(ComposerTextElementSchema).default([]),
  mentions: z.array(ComposerMentionBindingSchema).default([]),
  attachments: z.array(ComposerAttachmentSchema).default([]),
});
export type ComposerSubmission = z.infer<typeof ComposerSubmissionSchema>;

export function createPlainComposerSubmission(text: string): ComposerSubmission {
  return {
    text,
    textElements: [],
    mentions: [],
    attachments: [],
  };
}

export const WebModeSchema = z.enum(["disabled", "ask", "enabled"]);
export type WebMode = z.infer<typeof WebModeSchema>;

export const WebSearchTopicSchema = z.enum(["general", "news"]);
export type WebSearchTopic = z.infer<typeof WebSearchTopicSchema>;

export const WebSearchActionSchema = z.object({
  type: z.literal("search"),
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(10).optional(),
  includeDomains: z.array(z.string().min(1)).max(20).optional(),
  excludeDomains: z.array(z.string().min(1)).max(20).optional(),
  topic: WebSearchTopicSchema.optional(),
});
export type WebSearchAction = z.infer<typeof WebSearchActionSchema>;

export const WebOpenPageActionSchema = z.object({
  type: z.literal("openPage"),
  url: z.string().url(),
  maxChars: z.number().int().min(500).max(20000).optional(),
});
export type WebOpenPageAction = z.infer<typeof WebOpenPageActionSchema>;

export const WebFindInPageActionSchema = z.object({
  type: z.literal("findInPage"),
  url: z.string().url(),
  pattern: z.string().min(1).max(500),
  maxChars: z.number().int().min(500).max(20000).optional(),
});
export type WebFindInPageAction = z.infer<typeof WebFindInPageActionSchema>;

export const WebActionSchema = z.discriminatedUnion("type", [
  WebSearchActionSchema,
  WebOpenPageActionSchema,
  WebFindInPageActionSchema,
]);
export type WebAction = z.infer<typeof WebActionSchema>;

export const WebSearchResultItemSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().optional(),
});
export type WebSearchResultItem = z.infer<typeof WebSearchResultItemSchema>;

export const WebSearchActionResultSchema = z.object({
  type: z.literal("search"),
  provider: z.string().min(1),
  query: z.string().min(1),
  answer: z.string().optional(),
  results: z.array(WebSearchResultItemSchema),
});
export type WebSearchActionResult = z.infer<typeof WebSearchActionResultSchema>;

export const WebOpenPageActionResultSchema = z.object({
  type: z.literal("openPage"),
  provider: z.string().min(1),
  url: z.string().url(),
  title: z.string().optional(),
  content: z.string(),
});
export type WebOpenPageActionResult = z.infer<typeof WebOpenPageActionResultSchema>;

export const WebFindMatchSchema = z.object({
  line: z.number().int().positive(),
  text: z.string().min(1),
});
export type WebFindMatch = z.infer<typeof WebFindMatchSchema>;

export const WebFindInPageActionResultSchema = z.object({
  type: z.literal("findInPage"),
  provider: z.string().min(1),
  url: z.string().url(),
  pattern: z.string().min(1),
  matchCount: z.number().int().nonnegative(),
  matches: z.array(WebFindMatchSchema),
});
export type WebFindInPageActionResult = z.infer<typeof WebFindInPageActionResultSchema>;

export const WebActionResultSchema = z.discriminatedUnion("type", [
  WebSearchActionResultSchema,
  WebOpenPageActionResultSchema,
  WebFindInPageActionResultSchema,
]);
export type WebActionResult = z.infer<typeof WebActionResultSchema>;

export const AgentRequestSchema = z.object({
  task: z.string().min(1),
  repoRoot: z.string().min(1),
  approvalMode: ApprovalModeSchema,
  maxSteps: z.number().int().positive().default(24),
  maxDurationMs: z.number().int().positive().default(180000),
});
export type AgentRequest = z.infer<typeof AgentRequestSchema>;

export const ToolRequestSchema = z.object({
  name: z.string().min(1),
  input: z.record(z.unknown()),
});
export type ToolRequest = z.infer<typeof ToolRequestSchema>;

export const ToolResultSchema = z.object({
  ok: z.boolean(),
  output: z.string(),
  error: z.string().optional(),
  meta: z
    .object({
      durationMs: z.number().int().nonnegative().optional(),
      command: z.string().optional(),
      path: z.string().optional(),
    })
    .optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const AgentStepSchema = z.object({
  step: z.number().int().positive(),
  thought: z.string().optional(),
  action: z.string(),
  observation: z.string().optional(),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;

export const RunSummarySchema = z.object({
  success: z.boolean(),
  steps: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  estimatedCostUsd: z.number().nonnegative().default(0),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const TurnDecisionSchema = z.object({
  mode: z.enum(["direct-answer", "web-context", "repo-context", "answer", "change"]),
  rationale: z.string().min(1),
});
export type TurnDecision = z.infer<typeof TurnDecisionSchema>;

export const TuiKeybindsSchema = z.object({
  leader: z.string().trim().min(1).optional(),
  app_exit: z.string().trim().min(1).optional(),
  input_submit: z.string().trim().min(1).optional(),
  input_backspace: z.string().trim().min(1).optional(),
  input_clear: z.string().trim().min(1).optional(),
});
export type TuiKeybinds = z.infer<typeof TuiKeybindsSchema>;

export const TuiConfigSchema = z.object({
  keybinds: TuiKeybindsSchema.optional(),
});
export type TuiConfig = z.infer<typeof TuiConfigSchema>;

export class PolicyError extends Error {
  readonly kind = "PolicyError";
}

export class ToolExecutionError extends Error {
  readonly kind = "ToolExecutionError";
}

export class ProviderError extends Error {
  readonly kind = "ProviderError";
}

export class ValidationError extends Error {
  readonly kind = "ValidationError";
}
