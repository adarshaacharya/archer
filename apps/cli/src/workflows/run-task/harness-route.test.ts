import { describe, expect, it } from "bun:test";
import { shouldUseHarnessPath } from "./harness-route.js";

describe("shouldUseHarnessPath", () => {
  it("always uses harness path", () => {
    expect(shouldUseHarnessPath({ declaredIntent: "question", workflowKind: "default" })).toBe(
      true,
    );
    expect(shouldUseHarnessPath({ declaredIntent: "change", workflowKind: "commit" })).toBe(true);
    expect(shouldUseHarnessPath({ declaredIntent: "question", workflowKind: "compact" })).toBe(true);
  });
});
