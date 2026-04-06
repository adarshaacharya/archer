import type { ShellProvider, ShellResult } from "@openharness/core";

import type { SandboxPolicy } from "../policy.js";
import { PolicyError } from "./fs-provider.js";

export class SandboxShellProvider implements ShellProvider {
    constructor(
        private readonly base: ShellProvider,
        private readonly policy: SandboxPolicy,
    ) { }

    async exec(
        command: string,
        options?: {
            timeout?: number;
            cwd?: string;
            env?: Record<string, string>;
        },
    ): Promise<ShellResult> {
        const decision = this.policy.decideCommand(command);

        if (decision === "ask") {
            throw new PolicyError(
                `Sandbox blocked command: ${command} (${decision})`,
            );
        }

        return this.base.exec(command, options);
    }
}
