#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(scriptDir, "..");
const entrypoint = path.join(cliRoot, "src", "index.ts");

const TARGETS = new Map([
  ["bun-darwin-arm64", { artifact: "darwin-arm64", binaryName: "archer" }],
  ["bun-darwin-x64", { artifact: "darwin-x64", binaryName: "archer" }],
  ["bun-linux-arm64", { artifact: "linux-arm64", binaryName: "archer" }],
  ["bun-linux-x64", { artifact: "linux-x64", binaryName: "archer" }],
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

const outDir = path.join(cliRoot, "dist", "bin", targetInfo.artifact);
const outfile = path.join(outDir, targetInfo.binaryName);

await mkdir(outDir, { recursive: true });

const build = Bun.spawn({
  cmd: ["bun", "build", entrypoint, "--compile", `--target=${target}`, `--outfile=${outfile}`],
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await build.exited;
if (exitCode !== 0) {
  process.exit(exitCode);
}

console.log(`Built ${target} binary at ${outfile}`);
