import { describe, expect, it } from "bun:test";
import { PromptHistory } from "./prompt-history.js";

describe("PromptHistory", () => {
  it("walks backward through submitted prompts and restores the draft", () => {
    const history = new PromptHistory();
    history.record("first");
    history.record("second");

    expect(history.previous("draft")).toBe("second");
    expect(history.previous("draft")).toBe("first");
    expect(history.next()).toBe("second");
    expect(history.next()).toBe("draft");
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

    expect(history.previous("")).toBe("three");
    expect(history.previous("")).toBe("two");
    expect(history.previous("")).toBe("two");
  });

  it("exits navigation when editing resumes", () => {
    const history = new PromptHistory();
    history.record("one");
    history.record("two");

    expect(history.previous("draft")).toBe("two");
    history.clearNavigation();
    history.syncDraft("edited");

    expect(history.previous("edited")).toBe("two");
    expect(history.next()).toBe("edited");
  });
});
