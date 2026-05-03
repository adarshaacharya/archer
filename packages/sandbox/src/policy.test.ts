import { describe, expect, test } from "bun:test";
import { classifyCommandRisk, DefaultSandboxPolicy } from "./policy.js";

describe("DefaultSandboxPolicy approval profiles", () => {
  test("read-only denies writes", () => {
    const policy = new DefaultSandboxPolicy("/tmp/project", "read-only");
    expect(policy.decidePathAccess("/tmp/project/src/file.ts", "write")).toBe("deny");
    expect(policy.decidePathAccess("/tmp/project/src/file.ts", "read")).toBe("allow");
  });

  test("workspace-write asks for writes", () => {
    const policy = new DefaultSandboxPolicy("/tmp/project", "workspace-write");
    expect(policy.decidePathAccess("/tmp/project/src/file.ts", "write")).toBe("ask");
  });

  test("danger-full-access allows writes in workspace", () => {
    const policy = new DefaultSandboxPolicy("/tmp/project", "danger-full-access");
    expect(policy.decidePathAccess("/tmp/project/src/file.ts", "write")).toBe("allow");
  });
});

describe("classifyCommandRisk approval profiles", () => {
  test("workspace-write still asks for mutating commands", () => {
    expect(classifyCommandRisk("bun install", "workspace-write")).toBe("ask");
  });

  test("danger-full-access auto-allows normal mutating commands", () => {
    expect(classifyCommandRisk("bun install", "danger-full-access")).toBe("allow");
  });

  test("danger-full-access still denies dangerous commands", () => {
    expect(classifyCommandRisk("rm -rf /tmp/foo", "danger-full-access")).toBe("deny");
  });
});
