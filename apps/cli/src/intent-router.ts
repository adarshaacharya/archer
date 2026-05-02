export type InputIntent = "question" | "research" | "change" | "ambiguous";

export type RoutedInput =
  | {
      intent: "question" | "research" | "change";
      task: string;
    }
  | {
      intent: "ambiguous";
      reason: string;
    };

const CHANGE_VERBS = [
  "add",
  "build",
  "change",
  "create",
  "delete",
  "fix",
  "implement",
  "improve",
  "make",
  "patch",
  "refactor",
  "remove",
  "rename",
  "replace",
  "update",
  "write",
];

const QUESTION_OPENERS = [
  "what",
  "why",
  "how",
  "which",
  "who",
  "where",
  "when",
  "is",
  "are",
  "can",
  "could",
  "should",
  "does",
  "do",
];

const RESEARCH_PHRASES = [
  "check current state",
  "compare",
  "investigate",
  "look through",
  "read through",
  "research",
  "review",
  "understand",
];

export function routeInput(raw: string): RoutedInput {
  const task = raw.trim();
  if (!task) {
    return {
      intent: "ambiguous",
      reason: "Empty input.",
    };
  }

  const normalized = normalize(task);
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const hasQuestionMark = task.includes("?");
  const startsWithQuestion = QUESTION_OPENERS.some(
    (opener) => normalized === opener || normalized.startsWith(`${opener} `),
  );
  const mentionsCode = /\b(code|repo|repository|app|project|file|folder|function|harness|agent)\b/.test(
    normalized,
  );
  const mentionsChange = CHANGE_VERBS.some(
    (verb) => normalized === verb || normalized.startsWith(`${verb} `) || normalized.includes(` ${verb} `),
  );
  const mentionsResearch = RESEARCH_PHRASES.some((phrase) => normalized.includes(phrase));

  if (mentionsResearch && !mentionsChange) {
    return { intent: "research", task };
  }

  if (hasQuestionMark || startsWithQuestion) {
    return { intent: "question", task };
  }

  if (mentionsChange) {
    return { intent: "change", task };
  }

  if (wordCount <= 3 && !mentionsCode) {
    return {
      intent: "ambiguous",
      reason: "Short input without a concrete task or question.",
    };
  }

  if (mentionsCode) {
    return { intent: "research", task };
  }

  return {
    intent: "ambiguous",
    reason: "Input does not clearly ask a question, research request, or code change.",
  };
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}
