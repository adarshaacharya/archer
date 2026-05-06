import { describe, expect, it } from "bun:test";
import { PromptHistory } from "./prompt-history.js";

describe("PromptHistory", () => {
  it("walks backward through submitted prompts and restores the draft", () => {
    const history = new PromptHistory();
    history.record("first");
    history.record("second");

    expect(history.previous("draft")).toEqual({ text: "second", mentions: [] });
    expect(history.previous("draft")).toEqual({ text: "first", mentions: [] });
    expect(history.next()).toEqual({ text: "second", mentions: [] });
    expect(history.next()).toEqual({ text: "draft", mentions: [] });
    expect(history.next()).toBeNull();
  });

  it("ignores empty submissions", () => {
    const history = new PromptHistory();
    history.record("   ");

    expect(history.previous("draft")).toBeNull();
  });

  it("drops the oldest entries when the limit is exceeded", () => {
    const history = new PromptHistory(2);
    history.record("one");
    history.record("two");
    history.record("three");

    expect(history.previous("")).toEqual({ text: "three", mentions: [] });
    expect(history.previous("")).toEqual({ text: "two", mentions: [] });
    expect(history.previous("")).toEqual({ text: "two", mentions: [] });
  });

  it("exits navigation when editing resumes", () => {
    const history = new PromptHistory();
    history.record("one");
    history.record("two");

    expect(history.previous("draft")).toEqual({ text: "two", mentions: [] });
    history.clearNavigation();
    history.syncDraft("edited");

    expect(history.previous("edited")).toEqual({ text: "two", mentions: [] });
    expect(history.next()).toEqual({ text: "edited", mentions: [] });
  });

  it("preserves mention bindings in local history entries", () => {
    const history = new PromptHistory();
    history.record({
      text: "check @src/index.ts",
      mentions: [
        {
          id: "m1",
          label: "@src/index.ts",
          start: 6,
          end: 19,
          target: { type: "file", path: "src/index.ts" },
        },
      ],
    });

    expect(history.previous("draft")).toEqual({
      text: "check @src/index.ts",
      mentions: [
        {
          id: "m1",
          label: "@src/index.ts",
          start: 6,
          end: 19,
          target: { type: "file", path: "src/index.ts" },
        },
      ],
    });
  });

  it("falls back to persistent text-only history after local entries", () => {
    const history = new PromptHistory();
    history.loadPersistentTexts(["persistent one", "persistent two"]);
    history.record("local");

    expect(history.previous("draft")).toEqual({ text: "local", mentions: [] });
    expect(history.previous("draft")).toEqual({ text: "persistent two", mentions: [] });
    expect(history.previous("draft")).toEqual({ text: "persistent one", mentions: [] });
  });
});
