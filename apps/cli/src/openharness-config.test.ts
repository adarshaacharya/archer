import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOpenHarnessConfig } from "./openharness-config.js";

const envVar = "XEQ_OPENHARNESS_CONFIG";
const xdgEnvVar = "XDG_CONFIG_HOME";
const originalEnv = process.env[envVar];
const originalXdgEnv = process.env[xdgEnvVar];

afterEach(() => {
  if (originalEnv == null) {
    delete process.env[envVar];
  } else {
    process.env[envVar] = originalEnv;
  }

  if (originalXdgEnv == null) {
    delete process.env[xdgEnvVar];
  } else {
    process.env[xdgEnvVar] = originalXdgEnv;
  }
});

describe("loadOpenHarnessConfig", () => {
  it("returns built-in defaults when no config file exists", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "xeq-openharness-"));

    const config = await loadOpenHarnessConfig(cwd);

    expect(config).toEqual({
      projectInstructions: true,
      skills: { paths: [] },
      mcpServers: {},
      subagents: { enabled: true },
    });

    rmSync(cwd, { recursive: true, force: true });
  });

  it("parses mcp servers and extra skill paths from the config file", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "xeq-openharness-"));
    mkdirSync(join(cwd, ".agents"), { recursive: true });
    process.env[envVar] = join(cwd, ".agents/openharness.json");

    writeFileSync(
      join(cwd, ".agents/openharness.json"),
      JSON.stringify({
        projectInstructions: false,
        skills: { paths: ["./.agents/skills", "./custom-skills"] },
        subagents: { enabled: false },
        mcpServers: {
          local: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
          },
        },
      }),
    );

    const config = await loadOpenHarnessConfig(cwd);

    expect(config).toEqual({
      projectInstructions: false,
      skills: { paths: ["./.agents/skills", "./custom-skills"] },
      subagents: { enabled: false },
      mcpServers: {
        local: {
          type: "stdio",
          command: "node",
          args: ["server.js"],
        },
      },
    });

    rmSync(cwd, { recursive: true, force: true });
  });

  it("merges global config with local overrides using XDG config home", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "xeq-openharness-"));
    const xdgConfigHome = mkdtempSync(join(tmpdir(), "xeq-xdg-"));
    process.env[xdgEnvVar] = xdgConfigHome;

    mkdirSync(join(xdgConfigHome, "xeq"), { recursive: true });
    writeFileSync(
      join(xdgConfigHome, "xeq", "openharness.json"),
      JSON.stringify({
        projectInstructions: true,
        skills: { paths: ["./global-skills"] },
        subagents: { enabled: false },
        mcpServers: {
          global: {
            type: "stdio",
            command: "global-server",
          },
        },
      }),
    );

    mkdirSync(join(cwd, ".agents"), { recursive: true });
    writeFileSync(
      join(cwd, ".agents", "openharness.json"),
      JSON.stringify({
        projectInstructions: false,
        skills: { paths: ["./local-skills"] },
        mcpServers: {
          local: {
            type: "http",
            url: "https://example.com/mcp",
          },
        },
      }),
    );

    const config = await loadOpenHarnessConfig(cwd);

    expect(config).toEqual({
      projectInstructions: false,
      skills: { paths: ["./global-skills", "./local-skills"] },
      subagents: { enabled: false },
      mcpServers: {
        global: {
          type: "stdio",
          command: "global-server",
        },
        local: {
          type: "http",
          url: "https://example.com/mcp",
        },
      },
    });

    rmSync(cwd, { recursive: true, force: true });
    rmSync(xdgConfigHome, { recursive: true, force: true });
  });
});
