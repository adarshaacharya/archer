import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOpenHarnessConfig } from "./openharness-config.js";

const xdgEnvVar = "XDG_CONFIG_HOME";
const originalXdgEnv = process.env[xdgEnvVar];

afterEach(() => {
  if (originalXdgEnv == null) {
    delete process.env[xdgEnvVar];
  } else {
    process.env[xdgEnvVar] = originalXdgEnv;
  }
});

describe("loadOpenHarnessConfig", () => {
  it("returns built-in defaults when no config file exists", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "archer-openharness-"));

    const config = await loadOpenHarnessConfig();

    expect(config).toEqual({
      projectInstructions: true,
      skills: { paths: [] },
      mcpServers: {},
      subagents: { enabled: true },
    });

    rmSync(cwd, { recursive: true, force: true });
  });

  it("reads global config from xdg config home", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "archer-openharness-"));
    const xdgConfigHome = mkdtempSync(join(tmpdir(), "archer-xdg-"));
    process.env[xdgEnvVar] = xdgConfigHome;

    mkdirSync(join(xdgConfigHome, "archer"), { recursive: true });
    writeFileSync(
      join(xdgConfigHome, "archer", "settings.json"),
      JSON.stringify({
        projectInstructions: false,
        skills: { paths: ["./global-skills"] },
        subagents: { enabled: false },
      }),
    );
    writeFileSync(
      join(xdgConfigHome, "archer", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          global: {
            type: "stdio",
            command: "global-server",
          },
        },
      }),
    );

    const config = await loadOpenHarnessConfig();

    expect(config).toEqual({
      projectInstructions: false,
      skills: { paths: ["./global-skills"] },
      subagents: { enabled: false },
      mcpServers: {
        global: {
          type: "stdio",
          command: "global-server",
        },
      },
    });

    rmSync(cwd, { recursive: true, force: true });
    rmSync(xdgConfigHome, { recursive: true, force: true });
  });
});
