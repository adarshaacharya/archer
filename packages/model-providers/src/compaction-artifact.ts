import { generateText, type ModelMessage } from "ai";
import { resolveCompactionModel, type SupportedProvider } from "./index.js";

export async function generateCompactContinuationArtifact(input: {
  content: string;
  provider?: SupportedProvider | null;
  modelId?: string;
}): Promise<{
  summary: string;
  criticalFiles: string[];
  openRisks: string[];
} | null> {
  const content = input.content.trim();
  if (!content) {
    return null;
  }

  try {
    const resolved = resolveCompactionModel({
      provider: input.provider ?? undefined,
      modelId: input.modelId,
    });

    const messages: ModelMessage[] = [
      {
        role: "system",
        content:
          "Summarize old coding-agent session context into compact continuation JSON. Return strict JSON only with keys: summary, criticalFiles, openRisks.",
      },
      {
        role: "user",
        content: [
          "Create a compact continuation brief from the session transcript below.",
          "Keep it implementation-focused and concise.",
          'Return exactly: {"summary": string, "criticalFiles": string[], "openRisks": string[]}',
          "",
          content.length > 20_000 ? `${content.slice(0, 20_000)}...` : content,
        ].join("\n"),
      },
    ];

    const response = await generateText({
      model: resolved.model,
      messages,
    });

    const parsed = extractJsonObject(response.text);
    if (!parsed) {
      return null;
    }

    const value = JSON.parse(parsed) as {
      summary?: unknown;
      criticalFiles?: unknown;
      openRisks?: unknown;
    };
    if (
      typeof value.summary !== "string" ||
      !Array.isArray(value.criticalFiles) ||
      !Array.isArray(value.openRisks)
    ) {
      return null;
    }

    const criticalFiles = value.criticalFiles.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    const openRisks = value.openRisks.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );

    return {
      summary: value.summary.trim(),
      criticalFiles: criticalFiles.slice(0, 12),
      openRisks: openRisks.slice(0, 8),
    };
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  const directStart = trimmed.indexOf("{");
  if (directStart === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let index = directStart; index < trimmed.length; index += 1) {
    const ch = trimmed[index];
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
        start = index;
      }
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return trimmed.slice(start, index + 1);
      }
    }
  }

  return null;
}
