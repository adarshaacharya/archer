import { resolveLanguageModel } from "@archer/model-providers";
import {
  HarnessPolicyEngine,
  type HarnessPolicyRule,
  HarnessToolRouter,
  HarnessTurnRunner,
  registerDefaultHarnessTools,
  type HarnessModelDecision,
  type HarnessModelLoop,
} from "@archer/harness";
import type { HarnessRuntimeConfig } from "@archer/shared/runtime";
import { generateText } from "ai";

type HarnessAnswerPathInput = {
  mode: "answer" | "change";
  task: string;
  cwd: string;
  modelId: string;
  sessionId: string;
  turnId: string;
  maxSteps: number;
  timeoutMs: number;
  runtimeConfig?: HarnessRuntimeConfig;
  providers: {
    fs: {
      readFile(path: string): Promise<string>;
      writeFile(path: string, content: string): Promise<void>;
      exists(path: string): Promise<boolean>;
      stat(path: string): Promise<unknown>;
      readdir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
      mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
      remove(path: string, options?: { recursive?: boolean }): Promise<void>;
      rename(oldPath: string, newPath: string): Promise<void>;
      resolvePath(path: string): string;
    };
    shell: {
      exec(
        command: string,
        options?: { timeout?: number; cwd?: string; env?: Record<string, string> },
      ): Promise<unknown>;
    };
  };
  requestApproval: (request: {
    toolName: string;
    permission: "read" | "edit" | "bash" | "web" | "unknown";
    reason: string;
  }) => Promise<boolean>;
};

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;
  return JSON.parse(candidate);
}

function parseDecision(rawText: string): HarnessModelDecision {
  const parsed = extractJson(rawText);
  if (!parsed || typeof parsed !== "object") {
    return { type: "final", text: rawText.trim() || "Task complete." };
  }
  const record = parsed as Record<string, unknown>;
  const type = record.type;
  if (type === "final" && typeof record.text === "string") {
    return { type: "final", text: record.text };
  }
  if (type === "tool_call" && typeof record.toolName === "string") {
    return {
      type: "tool_call",
      toolName: record.toolName,
      args:
        record.args && typeof record.args === "object"
          ? (record.args as Record<string, unknown>)
          : {},
    };
  }
  return { type: "final", text: rawText.trim() || "Task complete." };
}

class LlmHarnessModelLoop implements HarnessModelLoop {
  constructor(
    private readonly modelId: string,
    private readonly mode: "answer" | "change",
  ) {}

  async decide(params: Parameters<HarnessModelLoop["decide"]>[0]): Promise<HarnessModelDecision> {
    const resolved = resolveLanguageModel({ modelId: this.modelId });
    const observationsText =
      params.state.observations.length === 0
        ? "(none)"
        : params.state.observations
            .map(
              (entry) =>
                `step=${entry.step} tool=${entry.toolName} output=${JSON.stringify(entry.output).slice(0, 1200)}`,
            )
            .join("\n");

    const prompt = [
      "You are Archer Harness runtime model loop.",
      "Return JSON only. No markdown.",
      'Decision format: {"type":"final","text":"..."} OR {"type":"tool_call","toolName":"...","args":{...}}',
      "Allowed tools: readFile, listFiles, createDirectory, writeFile, editFile, deleteFile, bash",
      "Prefer reading files before making edits.",
      this.mode === "change"
        ? "This is a CHANGE turn. You are expected to make concrete file edits when needed."
        : "This is an ANSWER turn. Prefer read-only actions unless edits are explicitly required.",
      `Task: ${params.request.prompt}`,
      `Current step: ${params.step}/${params.request.maxSteps}`,
      "Previous tool observations:",
      observationsText,
      "Emit one decision now.",
    ].join("\n");

    const response = await generateText({
      model: resolved.model,
      prompt,
      temperature: 0,
    });
    return parseDecision(response.text);
  }
}

export async function runHarnessPath(
  input: HarnessAnswerPathInput,
): Promise<{ status: "completed" | "failed" | "cancelled"; outputText: string; steps: number; error?: string }> {
  const policyRules = input.runtimeConfig?.policy?.rules as HarnessPolicyRule[] | undefined;
  const policy = new HarnessPolicyEngine(
    policyRules && policyRules.length > 0 ? { rules: policyRules } : undefined,
  );
  const router = new HarnessToolRouter(policy, input.requestApproval);
  registerDefaultHarnessTools(router, input.providers as never);
  const modelLoop = new LlmHarnessModelLoop(input.modelId, input.mode);
  const runner = new HarnessTurnRunner(modelLoop, router);

  return runner.run({
    turnId: input.turnId,
    sessionId: input.sessionId,
    mode: input.mode,
    prompt: input.task,
    cwd: input.cwd,
    maxSteps: input.maxSteps,
    timeoutMs: input.timeoutMs,
  });
}

export async function runHarnessAnswerPath(
  input: Omit<HarnessAnswerPathInput, "mode">,
): Promise<{ status: "completed" | "failed" | "cancelled"; outputText: string; steps: number; error?: string }> {
  return runHarnessPath({
    ...input,
    mode: "answer",
  });
}
