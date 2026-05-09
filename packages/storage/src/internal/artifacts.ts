import { asc, eq } from "drizzle-orm";
import { getDb } from "../db.js";
import { messages } from "../schema.js";
import { COMPACT_ARTIFACT_KIND, COMPACTION_EVENT_KIND } from "./compaction.js";

export type CompactContinuationArtifact = {
  summary: string;
  criticalFiles: string[];
  openRisks: string[];
  source: "preturn-prune" | "manual";
  createdAt: number;
};

export type CompactionEventRecord = {
  trigger: "context-pressure" | "manual" | "preturn-prune";
  status: "started" | "succeeded" | "failed";
  summary: string | null;
  criticalFiles: string[];
  openRisks: string[];
  createdAt: number;
};

export async function loadCompactionEvents(sessionId: string): Promise<CompactionEventRecord[]> {
  const rows = await getDb().query.messages.findMany({
    where: eq(messages.session_id, sessionId),
    orderBy: [asc(messages.seq)],
  });

  return rows.flatMap((row) => {
    if (row.kind !== COMPACTION_EVENT_KIND) return [];
    try {
      const parsed = JSON.parse(row.content) as CompactionEventRecord;
      if (
        typeof parsed.trigger === "string" &&
        typeof parsed.status === "string" &&
        (typeof parsed.summary === "string" || parsed.summary === null) &&
        Array.isArray(parsed.criticalFiles) &&
        Array.isArray(parsed.openRisks) &&
        typeof parsed.createdAt === "number"
      ) {
        return [parsed];
      }
    } catch {}
    return [];
  });
}

export async function loadLatestCompactContinuationArtifact(
  sessionId: string,
): Promise<CompactContinuationArtifact | null> {
  const rows = await getDb().query.messages.findMany({
    where: eq(messages.session_id, sessionId),
    orderBy: [asc(messages.seq)],
  });

  for (const row of [...rows].reverse()) {
    if (row.kind !== COMPACT_ARTIFACT_KIND) continue;
    try {
      const parsed = JSON.parse(row.content) as CompactContinuationArtifact;
      if (
        typeof parsed.summary === "string" &&
        Array.isArray(parsed.criticalFiles) &&
        Array.isArray(parsed.openRisks) &&
        typeof parsed.source === "string" &&
        typeof parsed.createdAt === "number"
      ) {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  return null;
}
