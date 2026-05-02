export type CompactionReport = {
  summary: string;
  criticalFiles: string[];
  openRisks: string[];
};

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
    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === "\"") {
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
