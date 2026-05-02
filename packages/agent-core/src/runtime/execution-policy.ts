export function isContextBudgetResult(
  result: { status: string; error?: string } | null | undefined,
): boolean {
  if (!result || result.status !== "failed" || !result.error) {
    return false;
  }

  return (
    result.error.startsWith("Run exceeded maxSteps=") ||
    result.error === "Run cancelled" ||
    result.error.toLowerCase().includes("timeout")
  );
}

export function expandedContextSteps(maxSteps: number, initialContextSteps: number): number {
  const cap = Math.min(64, Math.max(24, Math.floor(maxSteps / 3)));
  return Math.max(initialContextSteps + 8, cap);
}

export function isMaxStepsResult(
  result: { status: string; error?: string } | null | undefined,
): boolean {
  return result?.status === "failed" && result.error?.startsWith("Run exceeded maxSteps=") === true;
}

export function buildQuestionLimitFinalAnswerPrompt(task: string, reason: string): string {
  return [
    "CRITICAL - QUESTION EXPLORATION LIMIT REACHED",
    "",
    reason,
    "",
    "Tools are disabled for this final response. Do not call any tools.",
    "Answer the user's question using only the repository evidence already gathered in this conversation.",
    "If the gathered evidence is incomplete, provide the best useful partial answer and state what remains uncertain.",
    "Do not say the turn failed if you can provide any useful answer.",
    "",
    "User question:",
    task.trim(),
  ].join("\n");
}

export function shouldInspectRepositoryForQuestion(
  task: string,
  intent: "change" | "question" | "research",
): boolean {
  if (intent === "research") {
    return true;
  }

  if (intent !== "question") {
    return false;
  }

  const normalized = task.trim().toLowerCase();
  return /\b(code|codebase|repo|repository|workspace|app|project|file|folder|directory|function|class|module|package|route|handler|implementation|implemented|defined|architecture|flow|harness|agent|cli|terminal|command|build|test|error|failing|failure|bug|stack trace|log)\b/.test(
    normalized,
  );
}
