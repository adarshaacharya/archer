import { describe, expect, it } from "bun:test";
import { HarnessEventBus } from "./event-bus.js";
import { HarnessPolicyEngine } from "./policy-engine.js";
import { registerDefaultHarnessTools } from "./tool-handlers.js";
import { HarnessToolRouter } from "./tool-router.js";

function createProviders() {
  const files = new Map<string, string>([["a.txt", "hello"]]);

  return {
    fs: {
      async readFile(path: string) {
        if (!files.has(path)) {
          throw new Error("not found");
        }
        return files.get(path)!;
      },
      async writeFile(path: string, content: string) {
        files.set(path, content);
      },
      async exists(path: string) {
        return files.has(path);
      },
      async stat() {
        return { isDirectory: false, isFile: true, size: 0, mtimeMs: 0 };
      },
      async readdir() {
        return [...files.keys()].map((name) => ({ name, isDirectory: false }));
      },
      async mkdir() {},
      async remove(path: string) {
        files.delete(path);
      },
      async rename(oldPath: string, newPath: string) {
        const value = files.get(oldPath);
        if (value == null) return;
        files.delete(oldPath);
        files.set(newPath, value);
      },
      resolvePath(path: string) {
        return path;
      },
    },
    shell: {
      async exec(command: string) {
        return { stdout: `ran:${command}`, stderr: "", exitCode: 0 };
      },
    },
  };
}

describe("registerDefaultHarnessTools", () => {
  it("reads and writes files through harness router", async () => {
    const providers = createProviders();
    const router = new HarnessToolRouter(new HarnessPolicyEngine());
    const bus = new HarnessEventBus();
    registerDefaultHarnessTools(router, providers as never);

    const read = await router.execute({
      turnId: "t1",
      step: 1,
      toolName: "readFile",
      args: { filePath: "a.txt" },
      eventBus: bus,
    });
    expect(read.ok).toBe(true);

    const write = await router.execute({
      turnId: "t1",
      step: 2,
      toolName: "writeFile",
      args: { filePath: "a.txt", content: "updated" },
      eventBus: bus,
    });
    expect(write.ok).toBe(false);
  });

  it("runs bash commands through harness router", async () => {
    const providers = createProviders();
    const router = new HarnessToolRouter(new HarnessPolicyEngine(), async () => true);
    const bus = new HarnessEventBus();
    registerDefaultHarnessTools(router, providers as never);

    const result = await router.execute({
      turnId: "t1",
      step: 1,
      toolName: "bash",
      args: { command: "echo ok" },
      eventBus: bus,
    });
    expect(result.ok).toBe(true);
  });
});
