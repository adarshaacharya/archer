export type TaskPhase = "context" | "implementation" | "verification";

export interface TaskPhaseController {
  phase: TaskPhase;
  beginImplementation(): void;
  beginVerification(): void;
  isContextPhase(): boolean;
  isVerificationPhase(): boolean;
}

export function createTaskPhaseController(
  initialPhase: TaskPhase = "context",
): TaskPhaseController {
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
    "Use the skill tool when a named skill would materially improve the task.",
    "Use spawnSubagent for delegated exploration, research, or narrow implementation work when a focused child run would be clearer than keeping everything in the main context.",
    "Use subagents for focused exploration or external research when it would reduce context pressure or narrow the main turn.",
    "If the user asks you to add a file in a missing folder inside the workspace, create the parent directory as part of the implementation instead of treating it as a blocker.",
    "Use createDirectory for explicit folder creation when needed, then use preparePatch or preparePatchBundle for file contents.",
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

export type QuestionStrategy = {
  initialDiscoveryPlan: string[];
  explorationBudget: {
    maxToolCalls: number;
    maxSpeculativeMisses: number;
    maxRepeatedScans: number;
  };
};

export function buildQuestionStrategy(
  task: string,
  mode: "question" | "research",
): QuestionStrategy {
  const normalized = task.trim().toLowerCase();
  const implementationQuestion =
    /\b(where|how|what|which)\b/.test(normalized) &&
    /\b(implemented|implementation|defined|code|file|function|class|route|handler|flow|cli|command)\b/.test(
      normalized,
    );

  return {
    initialDiscoveryPlan: [
      implementationQuestion
        ? "search first for likely symbols, filenames, commands, or routes from the user's wording"
        : "start from repository manifest and README-like files, then follow relevant references",
      "Choose the search path from the user's wording instead of relying on fixed question categories.",
      "Check package.json, README, AGENTS.md, or equivalent root docs when the question is broad.",
    ],
    explorationBudget: {
      maxToolCalls: mode === "research" ? 24 : 12,
      maxSpeculativeMisses: 3,
      maxRepeatedScans: 2,
    },
  };
}

export function buildResearchAnswerPrompt(
  task: string,
  mode: "question" | "research",
  strategy?: QuestionStrategy,
): string {
  return [
    mode === "question"
      ? "Answer the user's question by first inspecting the current repository state."
      : "Research the current repository state before responding.",
    "Read the relevant code, configuration, and docs before answering.",
    strategy ? `Initial discovery plan:\n- ${strategy.initialDiscoveryPlan.join("\n- ")}` : "",
    "Do not write, patch, or delete files in this phase.",
    "missing files must not fail the question turn; record them as misses and continue.",
    "If repository context is insufficient, say exactly what remains uncertain.",
    "Return a direct answer grounded in what you inspected.",
    "Task:",
    task.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildDirectAnswerPrompt(task: string): string {
  return [
    "Answer the user's question directly.",
    "Do not inspect the repository and do not call any tools.",
    "If the question is casual or general, respond naturally and briefly.",
    "If the question actually needs repository context, say what context would be needed instead of guessing.",
    "Task:",
    task.trim(),
  ].join("\n");
}

export function buildDirectAnswerSystemPrompt(): string {
  return [
    "You are XEQ, a terminal coding agent.",
    "Answer the user's direct question in plain text.",
    "Do not inspect files, search, run commands, or call tools.",
    "For casual questions, respond naturally and briefly.",
    "For coding or repository questions that need local context, say that repository inspection is needed.",
  ].join(" ");
}

export function buildWebAnswerPrompt(task: string): string {
  return [
    "Answer the user's question using web tools if needed.",
    "Do not inspect the repository unless the user explicitly asks about local code.",
    "If the user provided a URL, open it and extract the relevant content before answering.",
    "If web access is unavailable, say so clearly instead of guessing.",
    "Task:",
    task.trim(),
  ].join("\n");
}

export function buildWebAnswerSystemPrompt(): string {
  return [
    "You are XEQ, a terminal coding agent.",
    "Use web tools to inspect the provided URL or external sources when needed.",
    "Do not inspect local repository files unless the user asks about the repo.",
    "Answer plainly from the content you inspected.",
  ].join(" ");
}

export function prependContinuationBrief(
  prompt: string,
  continuation:
    | {
        summary: string;
        criticalFiles: string[];
        openRisks: string[];
      }
    | null
    | undefined,
): string {
  if (!continuation) {
    return prompt;
  }

  const criticalFiles =
    continuation.criticalFiles.length > 0 ? continuation.criticalFiles.join(", ") : "(none)";
  const openRisks =
    continuation.openRisks.length > 0 ? continuation.openRisks.join(" | ") : "(none)";

  return [
    "Continuation brief from prior compacted session context:",
    `Summary: ${continuation.summary.trim() || "(none)"}`,
    `Critical files: ${criticalFiles}`,
    `Open risks: ${openRisks}`,
    "",
    prompt,
  ].join("\n");
}

export function buildPlanningPrompt(
  task: string,
  contextSummary: string,
  priorTurnGuidance?: string,
): string {
  return [
    "Produce an execution plan for the task below.",
    "Use the gathered repository context and submit the plan with the submitPlan tool.",
    "Do not return raw JSON or markdown fences when the tool is available.",
    "Do not write, patch, or delete files in this phase.",
    "The submitPlan payload must have this exact shape:",
    '{ goal: string, steps: [{ id: string, title: string, targets: string[], rationale: string, verification: string }] }',
    "Keep steps concrete and minimal. If the task is simple, keep the plan short.",
    priorTurnGuidance ? `Recent turn guidance:\n${priorTurnGuidance.trim()}` : "",
    "Task:",
    task.trim(),
    "Context summary:",
    contextSummary.trim() || "(none)",
  ]
    .filter(Boolean)
    .join("\n");
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

export function buildVerificationPrompt(
  task: string,
  planJson: string,
  validationInstruction?: string,
): string {
  return [
    "Verify the implementation changes for the task below.",
    "Do not edit, patch, or delete files in this phase.",
    validationInstruction ?? "Inspect changed files and run relevant checks/tests/lint commands.",
    "If checks fail, report concrete failures and likely root causes.",
    "Submit the verification report with the submitVerificationReport tool.",
    "Do not return raw JSON or markdown fences when the tool is available.",
    "The submitVerificationReport payload must have this exact shape:",
    '{ passed: boolean, commands: string[], findings: string[] }',
    "Execution plan (JSON):",
    planJson.trim(),
    "Task:",
    task.trim(),
  ].join("\n");
}

export function buildCompactionPrompt(
  task: string,
  planJson: string,
  latestContext: string,
): string {
  return [
    "Create a compact continuation brief for the current task.",
    "Submit the continuation brief with the submitCompactionReport tool.",
    "Do not return raw JSON or markdown fences when the tool is available.",
    "The submitCompactionReport payload must have this exact shape:",
    '{ summary: string, criticalFiles: string[], openRisks: string[] }',
    "Keep summary dense and implementation-focused.",
    "Execution plan (JSON):",
    planJson.trim(),
    "Latest context/output:",
    latestContext.trim() || "(none)",
    "Task:",
    task.trim(),
  ].join("\n");
}
