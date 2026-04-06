import { spawn } from "node:child_process";
import type { SandboxExecOptions, SandboxExecResult, SandboxRunner } from "./types.js";

function withTimeout(
    child: ReturnType<typeof spawn>,
    timeoutMs: number,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`Sandbox command timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        child.once("exit", () => {
            clearTimeout(t);
            resolve();
        });
    });
}

export const runWithLinuxBwrap: SandboxRunner = async (
    command,
    options = {},
): Promise<SandboxExecResult> => {
    const cwd = options.cwd ?? process.cwd();
    const timeout = options.timeout ?? 30_000;
    const env = { ...process.env, ...(options.env ?? {}) };

    const args = [
        "--ro-bind", "/", "/",
        "--dev", "/dev",
        "--proc", "/proc",
        "--tmpfs", "/tmp",
        "--bind", cwd, cwd,
        "--chdir", cwd,
        "--unshare-net",
        "--",
        "bash",
        "-lc",
        command,
    ];

    const child = spawn("bwrap", args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
        stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
        stderr += d.toString("utf8");
    });

    await withTimeout(child, timeout);

    const exitCode = await new Promise<number>((resolve) => {
        child.once("close", (code) => resolve(code ?? 1));
    });

    return { stdout, stderr, exitCode };
};