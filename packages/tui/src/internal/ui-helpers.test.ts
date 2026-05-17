import { describe, expect, test } from "bun:test";
import { sanitizeSingleLinePaste } from "./ui-helpers.js";

describe("sanitizeSingleLinePaste", () => {
  test("collapses newlines for single-line prompts", () => {
    expect(sanitizeSingleLinePaste("sk-abc\r\ndef")).toBe("sk-abcdef");
  });

  test("strips null bytes", () => {
    expect(sanitizeSingleLinePaste("sk\0key")).toBe("skkey");
  });

  test("caps length", () => {
    expect(sanitizeSingleLinePaste("x".repeat(10), 4)).toBe("xxxx");
  });
});
