import { z } from "zod";

export const EvalScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  task: z.string().min(1),
  tags: z.array(z.string()).default([]),
  expectations: z.object({
    mustSucceed: z.boolean().default(true),
    maxSteps: z.number().int().positive().optional(),
    maxApprovals: z.number().int().nonnegative().optional(),
    maxFileReads: z.number().int().nonnegative().optional(),
    requiredToolNames: z.array(z.string()).default([]),
    forbiddenToolNames: z.array(z.string()).default([]),
    requiredChangedPaths: z.array(z.string()).default([]),
  }),
});

export type EvalScenario = z.infer<typeof EvalScenarioSchema>;

export const EvalRunSummarySchema = z.object({
  status: z.enum(["completed", "failed", "cancelled", "timed_out", "unknown"]),
  steps: z.number().int().nonnegative(),
  approvalCount: z.number().int().nonnegative().default(0),
  fileReadCount: z.number().int().nonnegative().default(0),
  changedPaths: z.array(z.string()).default([]),
  toolNames: z.array(z.string()).default([]),
  finalMessage: z.string().default(""),
});

export type EvalRunSummary = z.infer<typeof EvalRunSummarySchema>;

export const EvalScoreSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  findings: z.array(z.string()),
});

export type EvalScore = z.infer<typeof EvalScoreSchema>;
