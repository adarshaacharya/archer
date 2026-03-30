import { z } from "zod";

export const ApprovalModeSchema = z.enum(["suggest", "auto-edit"]);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

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
