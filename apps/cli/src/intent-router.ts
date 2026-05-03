export type InputIntent = "question" | "research" | "change";

const QUESTION_OPENERS = ["what", "why", "how", "which", "who", "where", "when", "is", "are", "can", "could"];

export function inferExplicitIntent(raw: string): InputIntent | null {
  const task = raw.trim();
  if (!task) {
    return null;
  }

  const normalized = normalize(task);
  const hasQuestionMark = task.includes("?");
  const startsWithQuestion = QUESTION_OPENERS.some(
    (opener) => normalized === opener || normalized.startsWith(`${opener} `),
  );

  if (hasQuestionMark || startsWithQuestion) {
    return "question";
  }

  return null;
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}
