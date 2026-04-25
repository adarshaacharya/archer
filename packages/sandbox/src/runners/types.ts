export interface SandboxExecOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
}

export type SandboxRunner = (
  command: string,
  options?: SandboxExecOptions,
) => Promise<SandboxExecResult>;
