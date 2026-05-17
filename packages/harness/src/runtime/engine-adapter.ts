import { runOpenHarnessRuntime } from "../openharness-runtime.js";
import type { RunOptions } from "../types.js";
import type { HarnessRuntimeDeps } from "./harness-types.js";
import type { RuntimePhaseResult } from "./phase-runner.js";

export type EngineRunOptions = RunOptions;

export type EngineAdapter = {
  run(
    deps: HarnessRuntimeDeps,
    prompt: string,
    options: EngineRunOptions,
  ): Promise<RuntimePhaseResult>;
};

export function createOpenHarnessEngineAdapter(): EngineAdapter {
  return {
    run(deps, prompt, options) {
      return runOpenHarnessRuntime(deps, prompt, options);
    },
  };
}
