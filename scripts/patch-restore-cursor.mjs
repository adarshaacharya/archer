#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let restoreCursorPath;

try {
  restoreCursorPath = require.resolve("restore-cursor");
} catch {
  process.exit(0);
}

const source = await readFile(restoreCursorPath, "utf8");

const next = source.replace(
  "import { onExit as signalExit } from 'signal-exit';",
  [
    "import signalExitModule from 'signal-exit';",
    "const signalExit = signalExitModule.onExit ?? signalExitModule;",
  ].join("\n"),
);

if (next !== source) {
  await writeFile(restoreCursorPath, next, "utf8");
  console.log("patched restore-cursor for Bun signal-exit interop");
}
