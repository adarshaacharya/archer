import { spawn } from "node:child_process";
import type { SandboxExecOptions, SandboxExecResult, SandboxRunner } from "./types.js";

function buildSeatbeltProfile(cwd: string): string {
  return `
(version 1)
(deny default)
(import "system.sb")
(allow process-exec)
(allow process-fork)
(allow file-read*)
(allow file-write* (subpath "${cwd}"))
(deny network*)
`.trim();
}

export const runWithMacosSeatbelt: SandboxRunner = async (
  command,
  options = {},
): Promise<SandboxExecResult> => {
  const cwd = options.cwd ?? process.cwd();
  const timeout = options.timeout ?? 30_000;
  const env = { ...process.env, ...(options.env ?? {}) };
  const profile = buildSeatbeltProfile(cwd);

  const args = ["-p", profile, "bash", "--noprofile", "--norc", "-c", command];

  const child = spawn("sandbox-exec", args, {
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
