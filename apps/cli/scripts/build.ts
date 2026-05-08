#!/usr/bin/env bun

import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(scriptDir, "..");

type TargetInfo = {
  key: string;
  artifact: string;
  platform: NodeJS.Platform;
  arch: string;
};

const TARGETS: TargetInfo[] = [
  { key: "bun-darwin-arm64", artifact: "darwin-arm64", platform: "darwin", arch: "arm64" },
  { key: "bun-darwin-x64", artifact: "darwin-x64", platform: "darwin", arch: "x64" },
  { key: "bun-linux-arm64", artifact: "linux-arm64", platform: "linux", arch: "arm64" },
  { key: "bun-linux-x64", artifact: "linux-x64", platform: "linux", arch: "x64" },
];

function defaultTarget(): string {
  const host = `${process.platform}-${process.arch}`;
  const match = TARGETS.find((target) => `${target.platform}-${target.arch}` === host);
  if (!match) {
    throw new Error(`Unsupported local platform ${host}`);
  }
  return match.key;
}

function parseTargets(argv: string[]): TargetInfo[] {
  const buildAll = argv.includes("--all");
  if (buildAll) {
    return TARGETS;
  }

  const namedTarget =
    process.env.ARCHER_TARGET ?? argv.find((arg) => arg.startsWith("bun-")) ?? defaultTarget();
  const match = TARGETS.find((target) => target.key === namedTarget);
  if (!match) {
    throw new Error(`Unsupported ARCHER_TARGET: ${namedTarget}`);
  }

  return [match];
}

function canBuildHere(target: TargetInfo): boolean {
  return process.platform === target.platform && process.arch === target.arch;
}

async function runCommand(cmd: string[], env: Record<string, string | undefined>): Promise<void> {
  const proc = Bun.spawn({
    cmd,
    cwd: cliRoot,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${cmd.join(" ")}`);
  }
}

async function main(): Promise<void> {
  const selectedTargets = parseTargets(process.argv.slice(2));

  for (const target of selectedTargets) {
    if (!canBuildHere(target)) {
      console.log(
        `Skipping ${target.key}: requires ${target.platform}-${target.arch}, current host is ${process.platform}-${process.arch}`,
      );
      continue;
    }

    console.log(`Packaging ${target.artifact}...`);
    await runCommand(["bun", "run", "scripts/package-binary.mjs", target.key], {
      ...process.env,
      ARCHER_TARGET: target.key,
    });
  }

  console.log("Build pipeline completed.");
}

await main();
