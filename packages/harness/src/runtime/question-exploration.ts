import type { QuestionStrategy } from "./task-flow.js";

export type QuestionExplorationState = {
  filesRead: Set<string>;
  manifestsDocsCovered: Set<string>;
  searchHits: number;
  misses: Set<string>;
  repeatedAttempts: Map<string, number>;
  repeatedDirectoryScans: number;
  toolCalls: number;
  stepsSinceNewRelevance: number;
};

export function createQuestionExplorationState(): QuestionExplorationState {
  return {
    filesRead: new Set(),
    manifestsDocsCovered: new Set(),
    searchHits: 0,
    misses: new Set(),
    repeatedAttempts: new Map(),
    repeatedDirectoryScans: 0,
    toolCalls: 0,
    stepsSinceNewRelevance: 0,
  };
}

export function recordQuestionStep(
  exploration: QuestionExplorationState,
  step: {
    action: string;
    observation?: string;
  },
): void {
  if (!step.action.startsWith("tool.")) {
    return;
  }

  if (step.observation === "started") {
    return;
  }

  exploration.toolCalls += 1;
  const observation = step.observation ?? "";
  const key = `${step.action}:${observation.slice(0, 240)}`;
  const seen = exploration.repeatedAttempts.get(key) ?? 0;
  exploration.repeatedAttempts.set(key, seen + 1);
  let foundNewSignal = seen === 0 && observation.trim().length > 0;

  if (/\b(enoent|no such file|not found|cannot find)\b/i.test(observation)) {
    exploration.misses.add(key);
    foundNewSignal = false;
  }

  if (step.action === "tool.grep" || step.action === "tool.bash") {
    const likelySearchOutput =
      /\b(src|app|apps|packages|lib|cmd|internal|crates|services|server|client|tests)\/.+:\d+/i.test(
        observation,
      );
    if (likelySearchOutput) {
      exploration.searchHits += 1;
    }
  }

  if (step.action === "tool.readFile") {
    const path = extractLikelyPath(observation);
    if (path) {
      const sizeBefore = exploration.filesRead.size;
      exploration.filesRead.add(path);
      if (isManifestOrRootDoc(path)) {
        exploration.manifestsDocsCovered.add(path);
      }
      foundNewSignal = exploration.filesRead.size > sizeBefore || foundNewSignal;
    }
  }

  if (step.action === "tool.listFiles" || step.action === "tool.bash") {
    const repeatedScans = [...exploration.repeatedAttempts.entries()].filter(
      ([attemptKey, count]) =>
        count > 1 &&
        (attemptKey.startsWith("tool.listFiles") ||
          /\b(ls|find|tree|rg --files)\b/i.test(attemptKey)),
    ).length;
    exploration.repeatedDirectoryScans = repeatedScans;
  }

  exploration.stepsSinceNewRelevance = foundNewSignal ? 0 : exploration.stepsSinceNewRelevance + 1;
}

function extractLikelyPath(text: string): string | null {
  const match = text.match(
    /(?:^|\s)((?:\.\/)?[\w./@-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|toml|yaml|yml|rs|py|go|java|kt|rb|php|cs|sql|sh|lock))(?:\s|$|:)/,
  );
  return match?.[1] ?? null;
}

function isManifestOrRootDoc(path: string): boolean {
  const normalized = path.replace(/^\.\//, "");
  return (
    !normalized.includes("/") &&
    /^(README(?:\..*)?|AGENTS\.md|CLAUDE\.md|GEMINI\.md|package\.json|Cargo\.toml|pyproject\.toml|go\.mod|Gemfile|composer\.json|pom\.xml|build\.gradle|Makefile|Dockerfile|pnpm-workspace\.yaml)$/i.test(
      normalized,
    )
  );
}

export function summarizeQuestionExploration(exploration: QuestionExplorationState) {
  return {
    filesRead: exploration.filesRead.size,
    manifestsDocsCovered: exploration.manifestsDocsCovered.size,
    searchHits: exploration.searchHits,
    misses: exploration.misses.size,
    repeatedAttempts: [...exploration.repeatedAttempts.values()].filter((count) => count > 1)
      .length,
    repeatedDirectoryScans: exploration.repeatedDirectoryScans,
    toolCalls: exploration.toolCalls,
    stepsSinceNewRelevance: exploration.stepsSinceNewRelevance,
  };
}

export type QuestionReadinessDecision = {
  ready: boolean;
  reason: string;
};

function ready(reason: string): QuestionReadinessDecision {
  return { ready: true, reason };
}

function notReady(reason: string): QuestionReadinessDecision {
  return { ready: false, reason };
}

export function evaluateQuestionAnswerReadiness(
  strategy: QuestionStrategy,
  exploration: QuestionExplorationState,
): QuestionReadinessDecision {
  if (exploration.toolCalls >= strategy.explorationBudget.maxToolCalls) {
    return ready("question exploration budget reached");
  }

  if (exploration.misses.size >= strategy.explorationBudget.maxSpeculativeMisses) {
    return ready("speculative file misses reached the exploration limit");
  }

  if (exploration.repeatedDirectoryScans >= strategy.explorationBudget.maxRepeatedScans) {
    return ready("directory scans are repeating without new signal");
  }

  if (exploration.stepsSinceNewRelevance >= 5 && exploration.toolCalls >= 4) {
    return ready("recent exploration stopped finding new relevant evidence");
  }

  return notReady("let the model decide whether current evidence is enough to answer");
}
