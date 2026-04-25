import type { ShellProvider, ShellResult } from "@openharness/core";
import type { ApprovalHandler } from "../approvals.js";
import type { SandboxPolicy } from "../policy.js";
import { getSandboxRunner } from "../runners/index.js";
import type { SandboxRunner } from "../runners/types.js";
import { PolicyError } from "./fs-provider.js";

export class SandboxShellProvider implements ShellProvider {
  private readonly runner: SandboxRunner;

  constructor(
    private readonly policy: SandboxPolicy,
    private readonly approvals?: ApprovalHandler,
  ) {
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

    if (decision === "ask" && this.approvals) {
      const approval = await this.approvals({
        kind: "command",
        target: command,
      });
      if (approval === "once" || approval === "always") {
        return this.runner(command, options);
      }
    }

    if (decision !== "allow") {
      throw new PolicyError(`Sandbox blocked command: ${command} (${decision})`);
    }

    return this.runner(command, options);
  }
}
