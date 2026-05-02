export type ExecutionPlan = {
  goal: string;
  steps: Array<{
    id: string;
    title: string;
    targets: string[];
    rationale: string;
    verification: string;
  }>;
};

export type VerificationReport = {
  passed: boolean;
  commands: string[];
  findings: string[];
};

export function buildPriorTurnPlanningGuidance(
  turns: Array<{
    status: string;
    task: string;
    summary?: unknown;
    message?: string | null;
  }>,
): string | null {
  const relevant = turns
    .filter((turn) => turn.status === "failed" || turn.status === "cancelled")
    .slice(-3);

  const lines: string[] = [];
  for (const turn of relevant) {
    const summary = turn.summary as
      | {
          steps?: unknown;
          durationMs?: unknown;
        }
      | null
      | undefined;
    const parts = [
      `- Prior ${turn.status} turn on: ${turn.task.replace(/\s+/g, " ").trim().slice(0, 120)}`,
    ];
    if (typeof summary?.steps === "number") {
      parts.push(`steps=${summary.steps}`);
    }
    if (typeof summary?.durationMs === "number") {
      parts.push(`durationMs=${Math.round(summary.durationMs)}`);
    }
    if (turn.message) {
      parts.push(`message=${turn.message.slice(0, 180)}`);
    }
    lines.push(parts.join("  "));
  }

  const heavyTurns = turns.filter((turn) => {
    const summary = turn.summary as { steps?: unknown } | null | undefined;
    return typeof summary?.steps === "number" && summary.steps >= 40;
  });
  if (heavyTurns.length >= 2) {
    lines.push(
      "- Recent turns were step-heavy. Prefer a tighter plan, fewer exploratory reads, and earlier verification.",
    );
  }

  return lines.length > 0 ? lines.join("\n") : null;
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

export function parseVerificationReport(raw: string): VerificationReport | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as {
      passed?: unknown;
      commands?: unknown;
      findings?: unknown;
    };
    if (
      typeof parsed.passed !== "boolean" ||
      !Array.isArray(parsed.commands) ||
      !Array.isArray(parsed.findings)
    ) {
      return null;
    }

    const commands = parsed.commands.filter((item): item is string => typeof item === "string");
    const findings = parsed.findings.filter((item): item is string => typeof item === "string");
    if (commands.length !== parsed.commands.length || findings.length !== parsed.findings.length) {
      return null;
    }

    return {
      passed: parsed.passed,
      commands,
      findings,
    };
  } catch {
    return null;
  }
}

function validateExecutionPlan(value: unknown): ExecutionPlan | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as {
    goal?: unknown;
    steps?: unknown;
  };

  if (typeof data.goal !== "string" || data.goal.trim() === "") {
    return null;
  }

  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    return null;
  }

  const steps = data.steps
    .map((step) => {
      if (!step || typeof step !== "object") {
        return null;
      }

      const s = step as {
        id?: unknown;
        title?: unknown;
        targets?: unknown;
        rationale?: unknown;
        verification?: unknown;
      };

      if (
        typeof s.id !== "string" ||
        typeof s.title !== "string" ||
        typeof s.rationale !== "string" ||
        typeof s.verification !== "string" ||
        !Array.isArray(s.targets)
      ) {
        return null;
      }

      const targets = s.targets.filter((target): target is string => typeof target === "string");
      if (targets.length !== s.targets.length) {
        return null;
      }

      return {
        id: s.id.trim(),
        title: s.title.trim(),
        targets: targets.map((target) => target.trim()).filter(Boolean),
        rationale: s.rationale.trim(),
        verification: s.verification.trim(),
      };
    })
    .filter((step): step is NonNullable<typeof step> => !!step);

  if (steps.length === 0 || steps.length !== data.steps.length) {
    return null;
  }

  return {
    goal: data.goal.trim(),
    steps,
  };
}

export function parseExecutionPlan(raw: string): ExecutionPlan | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return validateExecutionPlan(parsed);
  } catch {
    return null;
  }
}
