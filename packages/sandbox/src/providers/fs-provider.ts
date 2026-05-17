import type { HarnessDirEntry, HarnessFileStat, HarnessFsProvider } from "@archer/shared/runtime";
import type { ApprovalHandler } from "../approvals.js";
import type { SandboxPolicy } from "../policy.js";

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

export class SandboxFsProvider implements HarnessFsProvider {
  constructor(
    private readonly base: HarnessFsProvider,
    private readonly policy: SandboxPolicy,
    private readonly approvals?: ApprovalHandler,
  ) {}

  private async check(path: string, mode: "read" | "write"): Promise<void> {
    const resolved = this.base.resolvePath(path);
    const decision = this.policy.decidePathAccess(resolved, mode);
    if (decision === "allow") {
      return;
    }

    if (decision === "ask" && mode === "write" && this.approvals) {
      const approval = await this.approvals({
        kind: "file-write",
        target: resolved,
      });

      if (approval === "once" || approval === "always") {
        return;
      }
    }

    throw new PolicyError(`Sandbox blocked fs ${mode}: ${resolved} (${decision})`);
  }

  async readFile(path: string): Promise<string> {
    await this.check(path, "read");
    return this.base.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.check(path, "write");
    return this.base.writeFile(path, content);
  }

  async exists(path: string): Promise<boolean> {
    await this.check(path, "read");
    return this.base.exists(path);
  }

  async stat(path: string): Promise<HarnessFileStat> {
    await this.check(path, "read");
    return this.base.stat(path);
  }

  async readdir(path: string): Promise<HarnessDirEntry[]> {
    await this.check(path, "read");
    return this.base.readdir(path);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.check(path, "write");
    return this.base.mkdir(path, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.check(path, "write");
    return this.base.remove(path, options);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.check(oldPath, "write");
    await this.check(newPath, "write");
    return this.base.rename(oldPath, newPath);
  }

  resolvePath(path: string): string {
    return this.base.resolvePath(path);
  }
}
