export type TaskPhase = "context" | "implementation";

export interface TaskPhaseController {
  phase: TaskPhase;
  beginImplementation(): void;
  isContextPhase(): boolean;
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
    isContextPhase() {
      return phase === "context";
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

export function buildImplementationPrompt(task: string): string {
  return [
    "Implement the task below using the context gathered in the previous phase.",
    "If anything is still unclear, inspect the relevant files again before editing.",
    "Task:",
    task.trim(),
  ].join("\n");
}
