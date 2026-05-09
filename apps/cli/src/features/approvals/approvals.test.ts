import { describe, expect, it } from "bun:test";
import {
  clearSessionApprovalCache,
  hasSessionApproval,
  rememberSessionApproval,
} from "./approvals.js";

describe("session approval cache", () => {
  it("remembers once approvals for the current session only", () => {
    const sessionId = `session_${Date.now().toString(36)}`;
    const request = {
      kind: "file-write" as const,
      target: "/tmp/example.txt",
    };

    clearSessionApprovalCache(sessionId);

    expect(hasSessionApproval(sessionId, request)).toBe(false);

    rememberSessionApproval(sessionId, request);
    expect(hasSessionApproval(sessionId, request)).toBe(true);

    clearSessionApprovalCache(sessionId);
    expect(hasSessionApproval(sessionId, request)).toBe(false);
  });

  it("reuses file-write approvals for the same directory in the current session", () => {
    const sessionId = `session_${Date.now().toString(36)}`;
    const request = {
      kind: "file-write" as const,
      target: "/tmp/example/src/index.ts",
    };
    const sameDirectory = {
      kind: "file-write" as const,
      target: "/tmp/example/src/utils.ts",
    };
    const otherDirectory = {
      kind: "file-write" as const,
      target: "/tmp/example/docs/readme.md",
    };

    clearSessionApprovalCache(sessionId);

    rememberSessionApproval(sessionId, request);

    expect(hasSessionApproval(sessionId, request)).toBe(true);
    expect(hasSessionApproval(sessionId, sameDirectory)).toBe(true);
    expect(hasSessionApproval(sessionId, otherDirectory)).toBe(false);
  });

  it("keeps command approvals exact within the session", () => {
    const sessionId = `session_${Date.now().toString(36)}`;
    const request = {
      kind: "command" as const,
      target: "bun test",
    };
    const differentCommand = {
      kind: "command" as const,
      target: "bun run check-types",
    };

    clearSessionApprovalCache(sessionId);

    rememberSessionApproval(sessionId, request);

    expect(hasSessionApproval(sessionId, request)).toBe(true);
    expect(hasSessionApproval(sessionId, differentCommand)).toBe(false);
  });
});
