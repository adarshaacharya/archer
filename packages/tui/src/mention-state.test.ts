import { describe, expect, it } from "bun:test";
import {
  buildComposerTextElements,
  findActiveMentionQuery,
  insertFileMention,
  reconcileMentionBindings,
} from "./mention-state.js";

describe("findActiveMentionQuery", () => {
  it("finds an active mention token at the cursor", () => {
    expect(
      findActiveMentionQuery("check @packages/tui/src/op", "check @packages/tui/src/op".length),
    ).toEqual({
      query: "packages/tui/src/op",
      replaceStart: 6,
      replaceEnd: "check @packages/tui/src/op".length,
    });
  });

  it("returns null when the cursor is not inside a mention token", () => {
    expect(findActiveMentionQuery("hello world", 5)).toBeNull();
  });
});

describe("insertFileMention", () => {
  it("replaces the active query and creates a hidden binding", () => {
    const result = insertFileMention(
      "check @pack",
      {
        query: "pack",
        replaceStart: 6,
        replaceEnd: 11,
      },
      [],
      "packages/tui/src/opentui-tui.ts",
    );

    expect(result.text).toBe("check @packages/tui/src/opentui-tui.ts ");
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]?.label).toBe("@packages/tui/src/opentui-tui.ts");
    expect(result.mentions[0]?.target).toEqual({
      type: "file",
      path: "packages/tui/src/opentui-tui.ts",
    });
  });
});

describe("reconcileMentionBindings", () => {
  it("shifts bindings that occur after an edit", () => {
    const bindings = [
      {
        id: "a",
        label: "@src/index.ts",
        start: 6,
        end: 19,
        target: { type: "file" as const, path: "src/index.ts" },
      },
    ];

    const binding = bindings[0]!;
    expect(
      reconcileMentionBindings("check @src/index.ts", "please check @src/index.ts", bindings),
    ).toEqual([
      {
        ...binding,
        start: 13,
        end: 26,
      },
    ]);
  });

  it("drops bindings when the mention text itself is edited", () => {
    const bindings = [
      {
        id: "a",
        label: "@src/index.ts",
        start: 6,
        end: 19,
        target: { type: "file" as const, path: "src/index.ts" },
      },
    ];

    expect(
      reconcileMentionBindings("check @src/index.ts", "check @src/xndex.ts", bindings),
    ).toEqual([]);
  });
});

describe("buildComposerTextElements", () => {
  it("mirrors mention spans into text elements", () => {
    expect(
      buildComposerTextElements([
        {
          id: "a",
          label: "@src/index.ts",
          start: 6,
          end: 19,
          target: { type: "file" as const, path: "src/index.ts" },
        },
      ]),
    ).toEqual([
      {
        start: 6,
        end: 19,
        kind: "mention",
        display: "@src/index.ts",
        bindingId: "a",
      },
    ]);
  });
});
