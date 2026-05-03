import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapWorkspace } from "./init.js";

describe("bootstrapWorkspace", () => {
  it("creates the repo scaffold without overwriting existing files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "xeq-init-"));
    const existingAgents = join(cwd, "AGENTS.md");
    mkdirSync(join(cwd, ".agents/skills"), { recursive: true });

    await Bun.write(existingAgents, "custom agents");

    const first = await bootstrapWorkspace(cwd);
    expect(first.created).toEqual([]);
    expect(first.skipped).toContain(existingAgents);
    expect(existsSync(join(cwd, ".agents/skills"))).toBe(true);

    const second = await bootstrapWorkspace(cwd);
    expect(second.created).toEqual([]);

    expect(readFileSync(existingAgents, "utf8")).toBe("custom agents");

    rmSync(cwd, { recursive: true, force: true });
  });
});
