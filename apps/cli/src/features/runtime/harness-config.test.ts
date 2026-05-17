import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { loadHarnessConfig } from "./harness-config.js";

const ORIGINAL_XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;

afterEach(() => {
  if (ORIGINAL_XDG_CONFIG_HOME === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = ORIGINAL_XDG_CONFIG_HOME;
  }
});

describe("loadHarnessConfig", () => {
  it("returns defaults when no config files exist", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "archer-openharness-"));
    process.env.XDG_CONFIG_HOME = cwd;

    const config = await loadHarnessConfig();

    expect(config).toEqual({
      projectInstructions: true,
      skills: { paths: [] },
      mcpServers: {},
      subagents: { enabled: true },
      policy: { rules: [] },
    });
  });

  it("merges project and mcp config files", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "archer-openharness-"));
    process.env.XDG_CONFIG_HOME = cwd;
    const archerConfigDir = join(cwd, "archer");
    mkdirSync(archerConfigDir, { recursive: true });

    writeFileSync(
      join(archerConfigDir, "settings.json"),
      JSON.stringify({
        projectInstructions: false,
        skills: {
          paths: ["skills/custom", "skills/shared"],
        },
        subagents: {
          enabled: false,
        },
        policy: {
          rules: [
            {
              id: "deny-edit-answer",
              priority: 200,
              permission: "edit",
              action: "deny",
              reason: "no edits in answer mode",
              tool: ["writeFile", "editFile", "deleteFile"],
              mode: "answer",
            },
          ],
        },
      }),
    );

    writeFileSync(
      join(archerConfigDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          local: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
          },
        },
      }),
    );

    const config = await loadHarnessConfig();

    expect(config).toEqual({
      projectInstructions: false,
      skills: {
        paths: ["skills/custom", "skills/shared"],
      },
      mcpServers: {
        local: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
        },
      },
      subagents: {
        enabled: false,
      },
      policy: {
        rules: [
          {
            id: "deny-edit-answer",
            priority: 200,
            permission: "edit",
            action: "deny",
            reason: "no edits in answer mode",
            tool: ["writeFile", "editFile", "deleteFile"],
            mode: "answer",
          },
        ],
      },
    });
  });
});
