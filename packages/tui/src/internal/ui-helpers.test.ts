import { describe, expect, it } from "bun:test";
import { shouldUseUnicodeBoxDrawing } from "./ui-helpers.js";

describe("shouldUseUnicodeBoxDrawing", () => {
  it("allows unicode when the locale is UTF-8", () => {
    expect(shouldUseUnicodeBoxDrawing({ LANG: "en_US.UTF-8" })).toBe(true);
    expect(shouldUseUnicodeBoxDrawing({ LC_ALL: "C.utf8" })).toBe(true);
  });

  it("falls back to ASCII for dumb terminals and non-UTF-8 locales", () => {
    expect(shouldUseUnicodeBoxDrawing({ TERM: "dumb", LANG: "en_US.UTF-8" })).toBe(false);
    expect(shouldUseUnicodeBoxDrawing({ LANG: "en_US" })).toBe(false);
  });
});
