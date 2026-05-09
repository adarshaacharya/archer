import { z } from "zod";

export const SubagentKindSchema = z.enum(["explore", "research", "verify", "implement", "custom"]);
export type SubagentKind = z.infer<typeof SubagentKindSchema>;

export const SubagentScopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("repo"),
    paths: z.array(z.string().min(1)).default([]),
  }),
  z.object({
    type: z.literal("web"),
    urls: z.array(z.string().url()).default([]),
    domains: z.array(z.string().min(1)).default([]),
  }),
  z.object({
    type: z.literal("mixed"),
    repoPaths: z.array(z.string().min(1)).default([]),
    urls: z.array(z.string().url()).default([]),
    domains: z.array(z.string().min(1)).default([]),
  }),
]);
export type SubagentScope = z.infer<typeof SubagentScopeSchema>;

export const SubagentToolPolicySchema = z.object({
  allow: z.array(z.string().min(1)).default([]),
  deny: z.array(z.string().min(1)).default([]).optional(),
});
export type SubagentToolPolicy = z.infer<typeof SubagentToolPolicySchema>;

export const SpawnSubagentInputSchema = z.object({
  name: z.string().min(1).optional(),
  kind: SubagentKindSchema,
  prompt: z.string().min(1),
  scope: SubagentScopeSchema,
  toolPolicy: SubagentToolPolicySchema.optional(),
  background: z.boolean().default(false).optional(),
  maxSteps: z.number().int().positive().max(100).optional(),
  maxDurationMs: z
    .number()
    .int()
    .positive()
    .max(10 * 60 * 1000)
    .optional(),
  resumeKey: z.string().min(1).optional(),
  parentTurnId: z.string().min(1).optional(),
  expectedOutput: z.enum(["summary", "findings", "patch", "citations"]).optional(),
});
export type SpawnSubagentInput = z.infer<typeof SpawnSubagentInputSchema>;

export const SpawnSubagentResultSchema = z.object({
  subagentId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  status: z.enum(["completed", "failed", "stopped", "running"]),
  summary: z.string().min(1),
  findings: z.array(z.string()).default([]),
  citations: z
    .array(
      z.object({
        type: z.enum(["file", "url"]),
        ref: z.string().min(1),
        excerpt: z.string().optional(),
      }),
    )
    .default([]),
  artifacts: z
    .array(
      z.object({
        type: z.enum(["patch", "notes", "json"]),
        content: z.string().min(1),
      }),
    )
    .default([]),
  trace: z.object({
    parentTurnId: z.string().min(1),
    childTurnId: z.string().min(1),
    kind: SubagentKindSchema,
    startedAt: z.string().min(1),
    finishedAt: z.string().min(1).optional(),
  }),
});
export type SpawnSubagentResult = z.infer<typeof SpawnSubagentResultSchema>;

export const SubagentRunStatusSchema = z.enum(["running", "done", "failed", "cancelled"]);
export type SubagentRunStatus = z.infer<typeof SubagentRunStatusSchema>;

export const SubagentStatusInputSchema = z.object({
  subagentId: z.string().min(1),
});
export type SubagentStatusInput = z.infer<typeof SubagentStatusInputSchema>;

export const SubagentStatusResultSchema = z.object({
  subagentId: z.string().min(1),
  status: SubagentRunStatusSchema,
  sessionId: z.string().min(1).optional(),
  result: z.string().optional(),
  error: z.string().optional(),
});
export type SubagentStatusResult = z.infer<typeof SubagentStatusResultSchema>;

export const SubagentAwaitModeSchema = z.enum(["all", "allSettled", "any", "race"]);
export type SubagentAwaitMode = z.infer<typeof SubagentAwaitModeSchema>;

export const SubagentAwaitInputSchema = z.object({
  subagentIds: z.array(z.string().min(1)).min(1),
  mode: SubagentAwaitModeSchema,
});
export type SubagentAwaitInput = z.infer<typeof SubagentAwaitInputSchema>;

export const SubagentAwaitResultSchema = z.object({
  mode: SubagentAwaitModeSchema,
  results: z.array(SubagentStatusResultSchema),
});
export type SubagentAwaitResult = z.infer<typeof SubagentAwaitResultSchema>;

export const SubagentCancelInputSchema = z.object({
  subagentId: z.string().min(1),
});
export type SubagentCancelInput = z.infer<typeof SubagentCancelInputSchema>;

export const SubagentCancelResultSchema = z.object({
  subagentId: z.string().min(1),
  cancelled: z.boolean(),
});
export type SubagentCancelResult = z.infer<typeof SubagentCancelResultSchema>;
