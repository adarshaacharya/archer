#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(scriptDir, "..");

const TARGETS = new Map([
  ["bun-darwin-arm64", { artifact: "darwin-arm64", platform: "darwin", arch: "arm64" }],
  ["bun-darwin-x64", { artifact: "darwin-x64", platform: "darwin", arch: "x64" }],
  ["bun-linux-arm64", { artifact: "linux-arm64", platform: "linux", arch: "arm64" }],
  ["bun-linux-x64", { artifact: "linux-x64", platform: "linux", arch: "x64" }],
]);

function defaultTarget() {
  switch (`${process.platform}-${process.arch}`) {
    case "darwin-arm64":
      return "bun-darwin-arm64";
    case "darwin-x64":
      return "bun-darwin-x64";
    case "linux-arm64":
      return "bun-linux-arm64";
    case "linux-x64":
      return "bun-linux-x64";
    default:
      throw new Error(`Unsupported local platform ${process.platform}-${process.arch}`);
  }
}

const target = process.env.ARCHER_TARGET ?? Bun.argv[2] ?? defaultTarget();
const targetInfo = TARGETS.get(target);

if (!targetInfo) {
  throw new Error(`Unsupported ARCHER_TARGET: ${target}`);
}

if (process.platform !== targetInfo.platform || process.arch !== targetInfo.arch) {
  throw new Error(
    `ARCHER_TARGET=${target} must be built on ${targetInfo.platform}-${targetInfo.arch}; current host is ${process.platform}-${process.arch}`,
  );
}

await mkdir(path.join(cliRoot, "dist", "bin", targetInfo.artifact), { recursive: true });

const build = Bun.spawn({
  cmd: ["bun", "run", "build"],
  cwd: cliRoot,
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await build.exited;
if (exitCode !== 0) {
  process.exit(exitCode);
}

console.log(`Built Archer runtime bundle for ${targetInfo.artifact}`);
