import type { EvalScenario } from "./schema.js";

export const starterEvalScenarios: EvalScenario[] = [
  {
    id: "create-file-missing-dir",
    title: "Create file in missing directory",
    task: "Create lib/date.ts and add a helper that extracts a date string.",
    tags: ["filesystem", "file-creation", "missing-dir"],
    expectations: {
      mustSucceed: true,
      maxSteps: 24,
      maxApprovals: 2,
      maxFileReads: 6,
      requiredToolNames: ["createDirectory", "preparePatch"],
      forbiddenToolNames: [],
      requiredChangedPaths: ["lib/date.ts"],
    },
  },
  {
    id: "edit-existing-file",
    title: "Edit existing file with minimal churn",
    task: "Update the existing date helper to normalize whitespace but keep public behavior stable.",
    tags: ["edit", "minimal-change"],
    expectations: {
      mustSucceed: true,
      maxSteps: 24,
      maxApprovals: 1,
      maxFileReads: 8,
      requiredToolNames: ["preparePatch"],
      forbiddenToolNames: [],
      requiredChangedPaths: [],
    },
  },
  {
    id: "question-implementation-location",
    title: "Answer implementation location question without over-exploring",
    task: "Where is turn routing implemented?",
    tags: ["question", "repo-inspection"],
    expectations: {
      mustSucceed: true,
      maxSteps: 12,
      maxApprovals: 0,
      maxFileReads: 6,
      requiredToolNames: [],
      forbiddenToolNames: ["preparePatch", "createDirectory"],
      requiredChangedPaths: [],
    },
  },
];
