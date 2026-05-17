import { describe, expect, it } from "bun:test";
import { HarnessEventBus } from "./event-bus.js";
import { HarnessPolicyEngine } from "./policy-engine.js";
import { HarnessToolRouter } from "./tool-router.js";

describe("HarnessToolRouter", () => {
  it("executes allowed tools", async () => {
    const bus = new HarnessEventBus();
    const router = new HarnessToolRouter(new HarnessPolicyEngine());
    router.registerTool("readFile", async () => "ok");

    const result = await router.execute({
      turnId: "t1",
      step: 1,
      toolName: "readFile",
      args: { filePath: "a.ts" },
      eventBus: bus,
    });

    expect(result.ok).toBe(true);
  });

  it("blocks denied tools", async () => {
    const bus = new HarnessEventBus();
    const router = new HarnessToolRouter(new HarnessPolicyEngine());
    router.registerTool("bash", async () => "should-not-run");

    const result = await router.execute({
      turnId: "t1",
      step: 1,
      toolName: "bash",
      args: { command: "rm -rf /tmp/x" },
      eventBus: bus,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected policy denial");
    }
    expect(result.error).toContain("Denied by policy");
  });
});
