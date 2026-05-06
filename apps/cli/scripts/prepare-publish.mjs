#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(scriptDir, "..");
const publishDir = path.join(cliRoot, ".publish");

await rm(publishDir, { recursive: true, force: true });
await mkdir(publishDir, { recursive: true });

await cp(path.join(cliRoot, "dist"), path.join(publishDir, "dist"), { recursive: true });
await copyIfExists(path.join(cliRoot, "README.md"), path.join(publishDir, "README.md"));
await copyIfExists(path.resolve(cliRoot, "..", "..", "LICENSE"), path.join(publishDir, "LICENSE"));

const sourcePackage = JSON.parse(await readFile(path.join(cliRoot, "package.json"), "utf8"));
const tuiPackage = JSON.parse(
  await readFile(path.resolve(cliRoot, "..", "..", "packages", "tui", "package.json"), "utf8"),
);
const openTuiVersion = tuiPackage.dependencies?.["@opentui/core"];

if (!openTuiVersion) {
  throw new Error("packages/tui/package.json is missing @opentui/core dependency");
}

const publishPackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  type: sourcePackage.type,
  repository: sourcePackage.repository,
  bin: sourcePackage.bin,
  files: ["dist"],
  license: "MIT",
  publishConfig: sourcePackage.publishConfig,
  engines: {
    node: ">=18",
  },
  dependencies: {
    "@opentui/core": openTuiVersion,
  },
};

await writeFile(
  path.join(publishDir, "package.json"),
  `${JSON.stringify(publishPackage, null, 2)}\n`,
);

console.log(`Prepared publish directory at ${publishDir}`);

async function copyIfExists(from, to) {
  try {
    await cp(from, to);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}
