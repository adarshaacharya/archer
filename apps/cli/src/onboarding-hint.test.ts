import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldShowInitHint } from "./onboarding-hint.js";

describe("shouldShowInitHint", () => {
  it("shows only once per repo when AGENTS.md is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "archer-onboarding-"));

    expect(shouldShowInitHint(cwd)).toBe(true);
    expect(shouldShowInitHint(cwd)).toBe(false);

    mkdirSync(join(cwd, "nested"), { recursive: true });
    expect(shouldShowInitHint(join(cwd, "nested"))).toBe(true);

    writeFileSync(join(cwd, "AGENTS.md"), "# AGENTS.md\n");
    expect(shouldShowInitHint(cwd)).toBe(false);

    rmSync(cwd, { recursive: true, force: true });
  });
});
