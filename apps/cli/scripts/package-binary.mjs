#!/usr/bin/env bun

import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(cliRoot, "..", "..");

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

const sourceBinary = path.join(cliRoot, "dist", "bin", targetInfo.artifact, targetInfo.binaryName);
const releaseDir = path.join(cliRoot, "release");
const archiveName = `archer-${targetInfo.artifact}.tar.gz`;
const archivePath = path.join(releaseDir, archiveName);
const packageJson = JSON.parse(await readFile(path.join(cliRoot, "package.json"), "utf8"));
const stageDir = await mkdtemp(path.join(os.tmpdir(), "archer-release-"));
const archiveRoot = path.join(stageDir, `archer-${packageJson.version}-${targetInfo.artifact}`);

try {
  await stat(sourceBinary);
} catch {
  const build = Bun.spawn({
    cmd: ["bun", "run", path.join(cliRoot, "scripts", "build-binary.mjs"), target],
    stdout: "inherit",
    stderr: "inherit",
    cwd: cliRoot,
  });
  const buildExitCode = await build.exited;
  if (buildExitCode !== 0) {
    process.exit(buildExitCode);
  }
}

await mkdir(archiveRoot, { recursive: true });
await mkdir(releaseDir, { recursive: true });

await cp(sourceBinary, path.join(archiveRoot, targetInfo.binaryName));
await cp(path.join(cliRoot, "README.md"), path.join(archiveRoot, "README.md"));
await cp(path.join(repoRoot, "LICENSE"), path.join(archiveRoot, "LICENSE"));

const tar = Bun.spawn({
  cmd: ["tar", "-czf", archivePath, "-C", stageDir, path.basename(archiveRoot)],
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await tar.exited;

await rm(stageDir, { recursive: true, force: true });

if (exitCode !== 0) {
  process.exit(exitCode);
}

console.log(`Packaged ${archivePath}`);
