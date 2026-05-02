import { describe, expect, it } from "bun:test";
import { storedPermissionMatchesRequest } from "./settings-store.js";

describe("stored permission matching", () => {
  it("matches file-write directory rules by subtree", () => {
    const rule = "/tmp/example/src/**";

    expect(
      storedPermissionMatchesRequest(rule, {
        kind: "file-write",
        target: "/tmp/example/src/index.ts",
      }),
    ).toBe(true);

    expect(
      storedPermissionMatchesRequest(rule, {
        kind: "file-write",
        target: "/tmp/example/src/components/button.ts",
      }),
    ).toBe(true);

    expect(
      storedPermissionMatchesRequest(rule, {
        kind: "file-write",
        target: "/tmp/example/docs/readme.md",
      }),
    ).toBe(false);
  });

  it("keeps command and web-fetch rules exact", () => {
    expect(
      storedPermissionMatchesRequest("bun test", {
        kind: "command",
        target: "bun test",
      }),
    ).toBe(true);

    expect(
      storedPermissionMatchesRequest("bun test", {
        kind: "command",
        target: "bun run check-types",
      }),
    ).toBe(false);

    expect(
      storedPermissionMatchesRequest("domain:example.com", {
        kind: "web-fetch",
        target: "domain:example.com",
      }),
    ).toBe(true);

    expect(
      storedPermissionMatchesRequest("domain:example.com", {
        kind: "web-fetch",
        target: "domain:openai.com",
      }),
    ).toBe(false);
  });
});
