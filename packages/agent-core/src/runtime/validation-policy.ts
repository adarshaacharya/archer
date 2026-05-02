import type { WorkflowKind } from "./continuation-policy.js";

export type ValidationScope = "none" | "targeted" | "standard";

export function deriveValidationScope(input: {
  workflowKind?: WorkflowKind;
  changedPaths?: string[];
}): ValidationScope {
  if (input.workflowKind === "commit") {
    return "none";
  }

  const changedPaths = input.changedPaths ?? [];
  if (changedPaths.length <= 1) {
    return "targeted";
  }

  return "standard";
}

export function buildVerificationScopeInstruction(scope: ValidationScope): string {
  switch (scope) {
    case "none":
      return "Do not run broad validation commands. Only confirm the requested workflow outcome.";
    case "targeted":
      return "Prefer the narrowest relevant validation for the changed files or package. Avoid repo-wide lint/test runs unless strictly necessary.";
    case "standard":
    default:
      return "Run relevant checks/tests/lint commands, keeping validation proportional to the changes.";
  }
}

