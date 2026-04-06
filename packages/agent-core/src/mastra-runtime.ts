import { Agent } from "@mastra/core/agent";
import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { DEFAULT_MAX_STEPS, DEFAULT_TIMEOUT_MS, type RunOptions, type RunResult } from "./types.js";

export interface MastraRuntimeStepEvent {
  step: number;
  action: string;
  thought?: string;
  observation?: string;
}

export interface MastraRuntimeDeps {
  modelId?: string;
  instructions?: string;
  onStep?: (event: MastraRuntimeStepEvent) => void;
}

function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`run timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export async function runMastraRuntime(
  deps: MastraRuntimeDeps,
  prompt: string,
  options: RunOptions,
): Promise<RunResult> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const runId = newRunId();
  let stepCounter = 1;

  const workspace = new Workspace({
    filesystem: new LocalFilesystem({
      basePath: options.cwd,
      contained: true,
    }),
    sandbox: new LocalSandbox({
      workingDirectory: options.cwd,
      isolation: "none",
    }),
    tools: {
      mastra_workspace_execute_command: {
        enabled: true,
        requireApproval: false,
      },
    },
  });
  await workspace.init();

  const agent = new Agent({
    id: "xeq-runtime-agent",
    name: "XEQ Runtime Agent",
    instructions:
      deps.instructions ??
      "You are XEQ, a terminal coding agent. Use workspace tools to inspect and modify code. Prefer mastra_workspace_execute_command for shell commands.",
    model: deps.modelId ?? process.env.AGENT_MODEL ?? "openai/gpt-4o-mini",
    workspace,
  });

  deps.onStep?.({
    step: 1,
    action: "model.generate",
    thought: "thinking",
    observation: "starting",
  });

  try {
    const output = await withTimeout(
      agent.generate(prompt, {
        maxSteps,
        runId,
        memory: {
          resource: `xeq:${options.cwd}`,
          thread: runId,
        },
      }),
      timeoutMs,
    );

    if (output.toolCalls && output.toolCalls.length > 0) {
      for (const _call of output.toolCalls) {
        stepCounter += 1;
        deps.onStep?.({
          step: stepCounter,
          action: "tool.call",
          observation: "called",
        });
      }
    }
    if (output.toolResults && output.toolResults.length > 0) {
      for (const _result of output.toolResults) {
        stepCounter += 1;
        deps.onStep?.({
          step: stepCounter,
          action: "tool.result",
          observation: "completed",
        });
      }
    }

    const steps = Math.max(stepCounter, output.steps?.length ?? 1);
    deps.onStep?.({
      step: steps,
      action: "model.final",
      thought: "completed",
      observation: output.text ?? "Task complete",
    });

    return {
      status: "completed",
      steps,
      outputText: output.text ?? "Task complete",
    };
  } catch (error) {
    deps.onStep?.({
      step: Math.max(1, stepCounter),
      action: "run.error",
      observation: error instanceof Error ? error.message : String(error),
    });

    return {
      status: "failed",
      steps: Math.max(1, stepCounter),
      outputText: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
