import { describe, expect, it } from "bun:test";
import { buildVerificationScopeInstruction, deriveValidationScope } from "./validation-policy.js";

describe("validation-policy", () => {
  it("skips validation scope for commit workflow", () => {
    expect(deriveValidationScope({ workflowKind: "commit" })).toBe("none");
  });

  it("uses targeted validation for single-file changes", () => {
    expect(deriveValidationScope({ changedPaths: ["packages/shared/src/index.ts"] })).toBe(
      "targeted",
    );
  });

  it("uses standard validation for broader changes", () => {
    expect(
      deriveValidationScope({
        changedPaths: ["a.ts", "b.ts"],
      }),
    ).toBe("standard");
  });

  it("builds targeted verification instructions", () => {
    expect(buildVerificationScopeInstruction("targeted")).toContain(
      "narrowest relevant validation",
    );
  });
});
