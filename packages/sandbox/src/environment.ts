import type { ApprovalMode } from "@archer/shared/approval";
import { type FsProvider, NodeFsProvider, type ShellProvider } from "@openharness/core";
import type { ApprovalHandler } from "./approvals.js";
import { DefaultSandboxPolicy } from "./policy.js";
import { SandboxFsProvider } from "./providers/fs-provider.js";
import { SandboxShellProvider } from "./providers/shell-provider.js";

export interface SandboxEnvironment {
  fs: FsProvider;
  shell: ShellProvider;
}

export function createSandboxEnvironment(opts: {
  cwd: string;
  approvalMode?: ApprovalMode;
  approvals?: ApprovalHandler;
}): SandboxEnvironment {
  const policy = new DefaultSandboxPolicy(opts.cwd, opts.approvalMode);

  const baseFs = new NodeFsProvider({ cwd: opts.cwd });
  const fs = new SandboxFsProvider(baseFs, policy, opts.approvals);
  const shell = new SandboxShellProvider(policy, opts.approvals);

  return { fs, shell };
}
