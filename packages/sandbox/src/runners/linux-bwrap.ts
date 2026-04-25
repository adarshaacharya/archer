import { spawn } from "node:child_process";
import type { SandboxExecOptions, SandboxExecResult, SandboxRunner } from "./types.js";

export const runWithLinuxBwrap: SandboxRunner = async (
  command,
  options = {},
): Promise<SandboxExecResult> => {
  const cwd = options.cwd ?? process.cwd();
  const timeout = options.timeout ?? 30_000;
  const env = { ...process.env, ...(options.env ?? {}) };

  const args = [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--bind",
    cwd,
    cwd,
    "--chdir",
    cwd,
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

  const completion = new Promise<{ exitCode: number; signal?: string }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ exitCode: code ?? 1, signal: signal ?? undefined });
    });
  });

  const result = await Promise.race([
    completion,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Sandbox command timed out after ${timeout}ms`));
      }, timeout);
    }),
  ]);

  return { stdout, stderr, exitCode: result.exitCode, signal: result.signal };
};
