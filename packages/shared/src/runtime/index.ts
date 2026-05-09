import { z } from "zod";
import { ApprovalModeSchema } from "../approval/index.js";

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

export const OpenHarnessMCPServerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    cwd: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("http"),
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
  }),
  z.object({
    type: z.literal("sse"),
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
  }),
]);
export type OpenHarnessMCPServer = z.infer<typeof OpenHarnessMCPServerSchema>;

export const OpenHarnessRuntimeConfigSchema = z.object({
  projectInstructions: z.boolean().default(true),
  skills: z
    .object({
      paths: z.array(z.string().min(1)).default([]),
    })
    .optional(),
  mcpServers: z.record(OpenHarnessMCPServerSchema).optional(),
  subagents: z
    .object({
      enabled: z.boolean().default(true),
    })
    .optional(),
});
export type OpenHarnessRuntimeConfig = z.infer<typeof OpenHarnessRuntimeConfigSchema>;

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
