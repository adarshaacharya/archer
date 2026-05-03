import { tool } from "ai";
import { z } from "zod";

export const ExecutionPlanSchema = z.object({
  goal: z.string().min(1),
  steps: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        targets: z.array(z.string()),
        rationale: z.string().min(1),
        verification: z.string().min(1),
      }),
    )
    .min(1),
});

export type SubmittedExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

export const VerificationReportSchema = z.object({
  passed: z.boolean(),
  commands: z.array(z.string()),
  findings: z.array(z.string()),
});

export type SubmittedVerificationReport = z.infer<typeof VerificationReportSchema>;

export const TurnDecisionSchema = z.object({
  mode: z.enum(["answer", "change"]),
  rationale: z.string().min(1),
});

export type SubmittedTurnDecision = z.infer<typeof TurnDecisionSchema>;

export const CompactionReportSchema = z.object({
  summary: z.string().min(1),
  criticalFiles: z.array(z.string()),
  openRisks: z.array(z.string()),
});

export type SubmittedCompactionReport = z.infer<typeof CompactionReportSchema>;

export function createSubmitPlanTool() {
  return tool({
    description:
      "Submit a structured execution plan for the current coding task. Use this when the task needs an explicit plan before implementation.",
    inputSchema: ExecutionPlanSchema,
    execute: async (input) => input,
  });
}

export function createSubmitVerificationReportTool() {
  return tool({
    description:
      "Submit a structured verification report for the current coding task after running relevant checks.",
    inputSchema: VerificationReportSchema,
    execute: async (input) => input,
  });
}

export function createSubmitTurnDecisionTool() {
  return tool({
    description:
      "Submit the structured routing decision for the current task after inspecting repository context.",
    inputSchema: TurnDecisionSchema,
    execute: async (input) => input,
  });
}

export function createSubmitCompactionReportTool() {
  return tool({
    description:
      "Submit a structured compaction/continuation brief for the current task after context pressure or truncation.",
    inputSchema: CompactionReportSchema,
    execute: async (input) => input,
  });
}
