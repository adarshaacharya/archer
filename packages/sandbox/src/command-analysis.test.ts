import { describe, expect, test } from "bun:test";
import { analyzeShellCommand } from "./command-analysis.js";

describe("analyzeShellCommand", () => {
  test("allows simple safe commands", () => {
    const result = analyzeShellCommand("rg TODO src");
    expect(result.kind).toBe("simple");
    expect(result.risk).toBe("allow");
  });

  test("asks for mutating package commands", () => {
    const result = analyzeShellCommand("bun install");
    expect(result.kind).toBe("simple");
    expect(result.risk).toBe("ask");
  });

  test("denies dangerous commands", () => {
    const result = analyzeShellCommand("rm -rf /tmp/foo");
    expect(result.kind).toBe("simple");
    expect(result.risk).toBe("deny");
  });

  test("segments compound commands", () => {
    const result = analyzeShellCommand("pwd && rg TODO src");
    expect(result.kind).toBe("compound");
    expect(result.risk).toBe("allow");
    if (result.kind === "compound") {
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0]?.argv[0]).toBe("pwd");
      expect(result.segments[1]?.argv[0]).toBe("rg");
    }
  });

  test("fails closed on redirection", () => {
    const result = analyzeShellCommand("rg TODO src > out.txt");
    expect(result.kind).toBe("too-complex");
    expect(result.risk).toBe("ask");
  });

  test("fails closed on command substitution", () => {
    const result = analyzeShellCommand("echo $(pwd)");
    expect(result.kind).toBe("too-complex");
    expect(result.risk).toBe("ask");
  });
});
