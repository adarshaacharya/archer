#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const requested = process.argv[2];
const level = requested ?? "patch";

if (!isValidLevel(level) && !isSemver(level)) {
  console.error("Usage: node scripts/bump-cli-version.mjs [patch|minor|major|x.y.z]");
  process.exit(1);
}

const packageJsonPath = fileURLToPath(new URL("../apps/cli/package.json", import.meta.url));
const raw = await readFile(packageJsonPath, "utf8");
const pkg = JSON.parse(raw);

if (typeof pkg.version !== "string") {
  throw new Error("apps/cli/package.json is missing a string version field");
}

const nextVersion = bumpVersion(pkg.version, level);
pkg.version = nextVersion;

await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(nextVersion);

function bumpVersion(version, input) {
  if (isSemver(input)) {
    return input;
  }

  const parts = version.split(".");
  if (parts.length !== 3) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  const [major, minor, patch] = parts.map((part) => Number.parseInt(part, 10));
  if ([major, minor, patch].some(Number.isNaN)) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  switch (input) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      return input;
  }
}

function isValidLevel(value) {
  return value === "patch" || value === "minor" || value === "major";
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+$/.test(value);
}
