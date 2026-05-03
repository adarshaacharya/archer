import { tool } from "ai";
import {
  SpawnSubagentInputSchema,
  type SpawnSubagentInput,
  type SpawnSubagentResult,
} from "@xeq/shared";

export type SpawnSubagentExecutor = (
  input: SpawnSubagentInput,
) => Promise<SpawnSubagentResult> | SpawnSubagentResult;

export function createSpawnSubagentTool(executeSubagent: SpawnSubagentExecutor) {
  return tool({
    description:
      "Spawn a focused subagent for delegated exploration, research, verification, or implementation work. Use this when the task benefits from a narrower context, a bounded tool policy, or a resumable child run.",
    inputSchema: SpawnSubagentInputSchema as unknown as typeof SpawnSubagentInputSchema,
    execute: async (input: SpawnSubagentInput) => {
      return (await executeSubagent(input)) as SpawnSubagentResult;
    },
  } as never);
}
