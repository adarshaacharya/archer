import type { HarnessShellProvider, HarnessShellResult } from "@archer/shared/runtime";
import type { ApprovalHandler } from "../approvals.js";
import type { SandboxPolicy } from "../policy.js";
import { getSandboxRunner } from "../runners/index.js";
import type { SandboxRunner } from "../runners/types.js";
import { PolicyError } from "./fs-provider.js";

export class SandboxShellProvider implements HarnessShellProvider {
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
  ): Promise<HarnessShellResult> {
    const decision = this.policy.decideCommand(command);

    if (decision === "ask" && this.approvals) {
      const approval = await this.approvals({
        kind: "command",
        target: command,
      });
      if (approval === "once" || approval === "always") {
        const result = await this.runner(command, options);
        return {
          ok: result.exitCode === 0,
          code: result.exitCode,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      }
    }

    if (decision !== "allow") {
      throw new PolicyError(`Sandbox blocked command: ${command} (${decision})`);
    }

    const result = await this.runner(command, options);
    return {
      ok: result.exitCode === 0,
      code: result.exitCode,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}
