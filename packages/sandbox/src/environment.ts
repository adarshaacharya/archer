import { type FsProvider, NodeFsProvider, type ShellProvider } from "@openharness/core";
import { DefaultSandboxPolicy } from "./policy.js";
import { SandboxFsProvider } from "./providers/fs-provider.js";
import { SandboxShellProvider } from "./providers/shell-provider.js";

export interface SandboxEnvironment {
  fs: FsProvider;
  shell: ShellProvider;
}

export function createSandboxEnvironment(opts: {
  cwd: string;
}): SandboxEnvironment {
  const policy = new DefaultSandboxPolicy(opts.cwd);

  const baseFs = new NodeFsProvider({ cwd: opts.cwd });
  const fs = new SandboxFsProvider(baseFs, policy);
  const shell = new SandboxShellProvider(policy);

  return { fs, shell };
}
