export type TaskPhase = "context" | "implementation" | "verification";

export interface TaskPhaseController {
  phase: TaskPhase;
  beginImplementation(): void;
  beginVerification(): void;
  isContextPhase(): boolean;
  isVerificationPhase(): boolean;
}

export function createTaskPhaseController(initialPhase: TaskPhase = "context"): TaskPhaseController {
  let phase = initialPhase;

  return {
    get phase() {
      return phase;
    },
    beginImplementation() {
      phase = "implementation";
    },
    beginVerification() {
      phase = "verification";
    },
    isContextPhase() {
      return phase === "context";
    },
    isVerificationPhase() {
      return phase === "verification";
    },
  };
}

export function buildSystemPrompt(): string {
  return [
    "You are XEQ, a terminal coding agent.",
    "Default to doing the work without asking questions. Treat short tasks as sufficient direction and infer missing details by reading the codebase and following existing conventions.",
    "Always begin by inspecting the relevant files and understanding the current implementation before making changes.",
    "Only ask when you are truly blocked after checking relevant context and cannot safely pick a reasonable default.",
    "This usually means the request is ambiguous in a way that materially changes the result, the action is destructive or security-sensitive, or you need a secret or value that cannot be inferred.",
    "If you must ask, do all non-blocked work first, ask exactly one targeted question, include your recommended default, and say what changes based on the answer.",
    "Never ask permission questions like 'Should I proceed?' or 'Do you want me to run tests?'; proceed with the most reasonable option and mention what you did.",
    "Make minimal safe edits and use tools deliberately.",
    "Prefer preparePatchBundle for multi-file changes and preparePatch for single-file changes.",
    "These tools show a reviewable diff and apply the change immediately when approved.",
  ].join(" ");
}

export function buildContextGatheringPrompt(task: string): string {
  return [
    "First inspect the current repository context for the task below.",
    "Read the relevant code, configs, and surrounding patterns before changing anything.",
    "Do not write, patch, or delete files in this phase.",
    "Summarize the important files you inspected and the safest implementation path.",
    "Task:",
    task.trim(),
  ].join("\n");
}

export function buildPlanningPrompt(task: string, contextSummary: string): string {
  return [
    "Produce an execution plan for the task below.",
    "Use the gathered repository context and output strict JSON only.",
    "Do not include markdown fences, commentary, or extra text.",
    "Do not write, patch, or delete files in this phase.",
    "Return this exact shape:",
    '{ "goal": string, "steps": [{ "id": string, "title": string, "targets": string[], "rationale": string, "verification": string }] }',
    "Keep steps concrete and minimal.",
    "Task:",
    task.trim(),
    "Context summary:",
    contextSummary.trim() || "(none)",
  ].join("\n");
}

export function buildImplementationPrompt(task: string, planJson: string): string {
  return [
    "Implement the task below using the context gathered in the previous phase.",
    "Follow the execution plan strictly and complete steps in order unless a dependency forces reordering.",
    "If anything is still unclear, inspect the relevant files again before editing.",
    "After completing the work, ensure the final response references what was changed for each step.",
    "Execution plan (JSON):",
    planJson.trim(),
    "Task:",
    task.trim(),
  ].join("\n");
}

export function buildVerificationPrompt(task: string, planJson: string): string {
  return [
    "Verify the implementation changes for the task below.",
    "Do not edit, patch, or delete files in this phase.",
    "Inspect changed files and run relevant checks/tests/lint commands.",
    "If checks fail, report concrete failures and likely root causes.",
    "Return strict JSON only (no markdown, no extra text) in this exact shape:",
    '{ "passed": boolean, "commands": string[], "findings": string[] }',
    "Execution plan (JSON):",
    planJson.trim(),
    "Task:",
    task.trim(),
  ].join("\n");
}
