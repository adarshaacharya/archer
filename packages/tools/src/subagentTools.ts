import { tool } from "ai";
import {
  SpawnSubagentInputSchema,
  SpawnSubagentResultSchema,
  SubagentAwaitInputSchema,
  SubagentAwaitResultSchema,
  SubagentCancelInputSchema,
  SubagentCancelResultSchema,
  SubagentStatusInputSchema,
  SubagentStatusResultSchema,
  type SpawnSubagentInput,
  type SpawnSubagentResult,
  type SubagentAwaitInput,
  type SubagentAwaitResult,
  type SubagentCancelInput,
  type SubagentCancelResult,
  type SubagentStatusInput,
  type SubagentStatusResult,
} from "@xeq/shared";

export type SpawnSubagentExecutor = (
  input: SpawnSubagentInput,
) => Promise<SpawnSubagentResult> | SpawnSubagentResult;

export type SubagentRegistryLike = {
  getStatus(subagentId: string): SubagentStatusResult | undefined;
  cancel(subagentId: string): boolean;
  awaitAll(subagentIds: string[]): Promise<Map<string, string>>;
  awaitAllSettled(
    subagentIds: string[],
  ): Promise<Map<string, { status: "done" | "failed" | "cancelled"; sessionId?: string; result?: string; error?: string }>>;
  awaitAny(
    subagentIds: string[],
  ): Promise<{ id: string; sessionId?: string; result: string }>;
  awaitRace(
    subagentIds: string[],
  ): Promise<{ id: string; sessionId?: string; result?: string; error?: string }>;
};

function createSpawnResultTool(executeSubagent: SpawnSubagentExecutor) {
  return tool({
    description:
      "Spawn a focused subagent for delegated exploration, research, verification, or implementation work. Use this when the task benefits from a narrower context, a bounded tool policy, or a resumable child run.",
    inputSchema: SpawnSubagentInputSchema as never,
    execute: async (input: SpawnSubagentInput) => {
      return (await executeSubagent(input)) as SpawnSubagentResult;
    },
  } as never);
}

function createStatusResultTool(registry: SubagentRegistryLike) {
  return tool({
    description: "Check the status of a background subagent run without blocking.",
    inputSchema: SubagentStatusInputSchema as never,
    execute: async (input: SubagentStatusInput) => {
      return (registry.getStatus(input.subagentId) ??
        ({
          subagentId: input.subagentId,
          status: "failed",
          error: `Subagent "${input.subagentId}" not found.`,
        } as const)) as SubagentStatusResult;
    },
  } as never);
}

function createCancelResultTool(registry: SubagentRegistryLike) {
  return tool({
    description: "Cancel a running background subagent.",
    inputSchema: SubagentCancelInputSchema as never,
    execute: async (input: SubagentCancelInput) => {
      const cancelled = registry.cancel(input.subagentId);
      return SubagentCancelResultSchema.parse({
        subagentId: input.subagentId,
        cancelled,
      }) as SubagentCancelResult;
    },
  } as never);
}

function createAwaitResultTool(registry: SubagentRegistryLike) {
  return tool({
    description: [
      "Wait for one or more background subagent runs to complete.",
      "",
      "Modes: all, allSettled, any, race",
    ].join("\n"),
    inputSchema: SubagentAwaitInputSchema as never,
    execute: async (input: SubagentAwaitInput) => {
      switch (input.mode) {
        case "all": {
          const results = await registry.awaitAll(input.subagentIds);
          return SubagentAwaitResultSchema.parse({
            mode: input.mode,
            results: [...results.entries()].map(([subagentId, result]) => ({
              subagentId,
              status: "done" as const,
              result,
            })),
          }) as SubagentAwaitResult;
        }
        case "allSettled": {
          const results = await registry.awaitAllSettled(input.subagentIds);
          return SubagentAwaitResultSchema.parse({
            mode: input.mode,
            results: [...results.entries()].map(([subagentId, result]) => ({
              subagentId,
              status: result.status,
              sessionId: result.sessionId,
              result: result.result,
              error: result.error,
            })),
          }) as SubagentAwaitResult;
        }
        case "any": {
          const result = await registry.awaitAny(input.subagentIds);
          return SubagentAwaitResultSchema.parse({
            mode: input.mode,
            results: [
              {
                subagentId: result.id,
                status: "done" as const,
                sessionId: result.sessionId,
                result: result.result,
              },
            ],
          }) as SubagentAwaitResult;
        }
        case "race": {
          const result = await registry.awaitRace(input.subagentIds);
          return SubagentAwaitResultSchema.parse({
            mode: input.mode,
            results: [
              {
                subagentId: result.id,
                status: result.error ? "failed" : "done",
                sessionId: result.sessionId,
                result: result.result,
                error: result.error,
              },
            ],
          }) as SubagentAwaitResult;
        }
      }
    },
  } as never);
}

export function createSpawnSubagentTool(executeSubagent: SpawnSubagentExecutor) {
  return createSpawnResultTool(executeSubagent);
}

export function createSubagentStatusTool(registry: SubagentRegistryLike) {
  return createStatusResultTool(registry);
}

export function createSubagentCancelTool(registry: SubagentRegistryLike) {
  return createCancelResultTool(registry);
}

export function createSubagentAwaitTool(registry: SubagentRegistryLike) {
  return createAwaitResultTool(registry);
}
