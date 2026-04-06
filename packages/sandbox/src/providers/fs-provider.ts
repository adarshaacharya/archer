import type { DirEntry, FileStat, FsProvider } from "@openharness/core";
import type { SandboxPolicy } from "../policy.js";

export class PolicyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PolicyError";
    }
}

export class SandboxFsProvider implements FsProvider {
    constructor(
        private readonly base: FsProvider,
        private readonly policy: SandboxPolicy,
    ) { }

    private check(path: string, mode: "read" | "write"): void {
        const resolved = this.base.resolvePath(path);
        const decision = this.policy.decidePathAccess(resolved, mode);
        if (decision !== "allow") {
            throw new PolicyError(`Sandbox blocked fs ${mode}: ${resolved} (${decision})`);
        }
    }

    readFile(path: string): Promise<string> {
        this.check(path, "read");
        return this.base.readFile(path);
    }

    writeFile(path: string, content: string): Promise<void> {
        this.check(path, "write");
        return this.base.writeFile(path, content);
    }

    exists(path: string): Promise<boolean> {
        this.check(path, "read");
        return this.base.exists(path);
    }

    stat(path: string): Promise<FileStat> {
        this.check(path, "read");
        return this.base.stat(path);
    }

    readdir(path: string): Promise<DirEntry[]> {
        this.check(path, "read");
        return this.base.readdir(path);
    }

    mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
        this.check(path, "write");
        return this.base.mkdir(path, options);
    }

    remove(path: string, options?: { recursive?: boolean }): Promise<void> {
        this.check(path, "write");
        return this.base.remove(path, options);
    }

    rename(oldPath: string, newPath: string): Promise<void> {
        this.check(oldPath, "write");
        this.check(newPath, "write");
        return this.base.rename(oldPath, newPath);
    }

    resolvePath(path: string): string {
        return this.base.resolvePath(path);
    }
}
