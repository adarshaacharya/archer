export type CompactionReport = {
  summary: string;
  criticalFiles: string[];
  openRisks: string[];
};

export type CompactionTrigger = "context-pressure";

export type CompactionMetadata = {
  policy: {
    protectTokens: number;
    prunableTokens: number;
  };
  attempted: boolean;
  attempts: number;
  trigger: CompactionTrigger | null;
  status: "not-needed" | "succeeded" | "failed";
  report: CompactionReport | null;
};

export function parseCompactionReport(raw: string): CompactionReport | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as {
      summary?: unknown;
      criticalFiles?: unknown;
      openRisks?: unknown;
    };
    if (
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.criticalFiles) ||
      !Array.isArray(parsed.openRisks)
    ) {
      return null;
    }

    const criticalFiles = parsed.criticalFiles.filter((item): item is string => typeof item === "string");
    const openRisks = parsed.openRisks.filter((item): item is string => typeof item === "string");
    if (
      criticalFiles.length !== parsed.criticalFiles.length ||
      openRisks.length !== parsed.openRisks.length
    ) {
      return null;
    }

    return {
      summary: parsed.summary.trim(),
      criticalFiles,
      openRisks,
    };
  } catch {
    return null;
  }
}

export function isContextPressureFailure(
  result: { status: string; error?: string } | null | undefined,
): boolean {
  if (!result || result.status !== "failed") {
    return false;
  }

  const text = `${result.error ?? ""}`.toLowerCase();
  return (
    text.includes("context") ||
    text.includes("prompt too long") ||
    text.includes("token") ||
    text.includes("maxsteps") ||
    text.includes("timed out") ||
    text.includes("timeout")
  );
}

export function deriveCompactionPolicy(
  recentTurns: Array<{ status: string; summary?: unknown }>,
): { protectTokens: number; prunableTokens: number } {
  const base = { protectTokens: 12_500, prunableTokens: 6_250 };
  const recentFailures = recentTurns.filter(
    (turn) => turn.status === "failed" || turn.status === "cancelled",
  ).length;
  const highStepTurns = recentTurns.filter((turn) => {
    const summary = turn.summary as { steps?: unknown } | null | undefined;
    return typeof summary?.steps === "number" && summary.steps >= 40;
  }).length;

  if (recentFailures >= 2 || highStepTurns >= 2) {
    return {
      protectTokens: 10_000,
      prunableTokens: 5_000,
    };
  }

  return base;
}

export function createCompactionMetadata(policy: {
  protectTokens: number;
  prunableTokens: number;
}): CompactionMetadata {
  return {
    policy,
    attempted: false,
    attempts: 0,
    trigger: null,
    status: "not-needed",
    report: null,
  };
}

export function recordCompactionAttempt(
  current: CompactionMetadata,
  options: {
    trigger: CompactionTrigger;
    report: CompactionReport | null;
    completed: boolean;
  },
): CompactionMetadata {
  return {
    ...current,
    attempted: true,
    attempts: current.attempts + 1,
    trigger: options.trigger,
    status: options.completed && options.report ? "succeeded" : "failed",
    report: options.report,
  };
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const directStart = trimmed.indexOf("{");
  if (directStart === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let i = directStart; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === undefined) {
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return trimmed.slice(start, i + 1);
      }
    }
  }

  return null;
}
