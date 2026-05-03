export type InputIntent = "question" | "research" | "change";
export type PreRouteKind = "direct-answer" | "web-context" | "repo-context" | "change";

export type PreRouteResult = {
  shouldQuery: boolean;
  mode: PreRouteKind;
  allowedToolNames?: string[];
  source: "fast-path" | "classifier";
  rationale: string;
};

export type PreRoutePlan =
  | {
      status: "resolved";
      result: PreRouteResult;
    }
  | {
      status: "needs-classification";
      rationale: string;
      allowedToolNames: ["submitTurnDecision"];
    };

// Keep only cheap, high-confidence syntax-like signals here.
// Anything semantic or ambiguous should fall through to the classifier.
const CASUAL_PATTERNS = [
  /^(hi|hello|hey|yo|howdy)\b/,
  /^(good (morning|afternoon|evening)|gm|gn)\b/,
  /^how are you\b/,
  /^(thanks|thank you|thx)\b/,
  /^(ok|okay|cool|nice|great|awesome)\b[!. ]*$/,
];
const CHANGE_PATTERNS = [
  /^(please\s+)?(fix|implement|add|create|update|refactor|remove|delete|rename|move|edit|change|write|make|build|patch|replace)\b/,
];
const URL_PATTERN = /\bhttps?:\/\/[^\s)]+/i;
const PATHLIKE_PATTERN = /(?:^|[\s(])(?:[a-z0-9_.-]+\/)+[a-z0-9_.-]+/i;

export function inferExplicitIntent(raw: string): InputIntent | null {
  const task = raw.trim();
  if (!task) {
    return null;
  }

  const plan = planPreRoute(task);
  if (plan.status !== "resolved") {
    return null;
  }
  if (plan.result.mode === "change") {
    return "change";
  }
  if (
    plan.result.mode === "direct-answer" ||
    plan.result.mode === "web-context" ||
    plan.result.mode === "repo-context"
  ) {
    return "question";
  }
  return null;
}

export function prerouteInput(raw: string): PreRouteResult | null {
  const plan = planPreRoute(raw);
  return plan.status === "resolved" ? plan.result : null;
}

export function planPreRoute(raw: string): PreRoutePlan {
  const task = raw.trim();
  if (!task) {
    return {
      status: "resolved",
      result: createPreRouteResult(
        "direct-answer",
        "empty input should not trigger repository inspection",
        "fast-path",
      ),
    };
  }

  const normalized = normalize(task);
  const isCasual = CASUAL_PATTERNS.some((pattern) => pattern.test(normalized));
  const isChangeRequest = CHANGE_PATTERNS.some((pattern) => pattern.test(normalized));
  const mentionsRepoContext = PATHLIKE_PATTERN.test(task) || /`[^`]+`/.test(task);

  if (isCasual) {
    return {
      status: "resolved",
      result: createPreRouteResult(
        "direct-answer",
        "casual or social input does not need repository context",
        "fast-path",
      ),
    };
  }

  if (URL_PATTERN.test(task)) {
    return {
      status: "resolved",
      result: createPreRouteResult(
        "web-context",
        "message includes an external URL that should be inspected with web tools",
        "fast-path",
      ),
    };
  }

  if (isChangeRequest) {
    return {
      status: "resolved",
      result: createPreRouteResult(
        "change",
        "explicit edit verb suggests a code modification task",
        "fast-path",
      ),
    };
  }

  if (mentionsRepoContext) {
    return {
      status: "resolved",
      result: createPreRouteResult(
        "repo-context",
        "message references repository-specific concepts or paths",
        "fast-path",
      ),
    };
  }

  return {
    status: "needs-classification",
    rationale: "ambiguous input should be classified before any repository inspection",
    allowedToolNames: ["submitTurnDecision"],
  };
}

export function preRouteResultFromMode(
  mode: PreRouteKind,
  rationale: string,
  source: "fast-path" | "classifier",
): PreRouteResult {
  return createPreRouteResult(mode, rationale, source);
}

function createPreRouteResult(
  mode: PreRouteKind,
  rationale: string,
  source: "fast-path" | "classifier",
): PreRouteResult {
  return {
    shouldQuery: mode !== "direct-answer",
    mode,
    allowedToolNames:
      mode === "direct-answer"
        ? []
        : mode === "web-context"
          ? ["webSearch", "webOpenPage", "webFindInPage"]
          : undefined,
    source,
    rationale,
  };
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}
