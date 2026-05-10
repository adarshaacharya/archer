import { describe, expect, it } from "bun:test";
import { parseCliArgs } from "./cli-args.js";

describe("parseCliArgs", () => {
  it("recognizes update mode", () => {
    const parsed = parseCliArgs(["--update"]);

    expect(parsed).toMatchObject({
      help: false,
      version: false,
      update: true,
      updateCheck: false,
      updateForce: false,
      initialTask: null,
    });
  });

  it("recognizes update command mode", () => {
    const parsed = parseCliArgs(["update", "--check"]);

    expect(parsed).toMatchObject({
      update: true,
      updateCheck: true,
      updateForce: false,
      initialTask: null,
    });
  });

  it("keeps positional input intact", () => {
    const parsed = parseCliArgs(["review", "this", "repo"]);

    expect(parsed.initialTask).toBe("review this repo");
  });
});
