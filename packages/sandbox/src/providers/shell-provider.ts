import type { ShellProvider, ShellResult } from "@openharness/core";
import type { SandboxPolicy } from "../policy.js";
import { getSandboxRunner } from "../runners/index.js";
import type { SandboxRunner } from "../runners/types.js";
import { PolicyError } from "./fs-provider.js";

export class SandboxShellProvider implements ShellProvider {
  private readonly runner: SandboxRunner;

  constructor(private readonly policy: SandboxPolicy) {
    this.runner = getSandboxRunner();
  }

  async exec(
    command: string,
    options?: {
      timeout?: number;
      cwd?: string;
      env?: Record<string, string>;
    },
  ): Promise<ShellResult> {
    const decision = this.policy.decideCommand(command);

    if (decision !== "allow") {
      throw new PolicyError(`Sandbox blocked command: ${command} (${decision})`);
    }

    return this.runner(command, options);
  }
}
