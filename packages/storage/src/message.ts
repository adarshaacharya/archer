import type { ModelMessage } from "ai";
import { and, asc, eq, max } from "drizzle-orm";
import { getDb } from "./db.js";
import { messages, model_messages } from "./schema.js";
import { touchSession } from "./session.js";

export type AppendMessageInput = {
  id: string;
  session_id: string;
  role: string;
  kind?: string;
  content: string;
  created_at?: number;
};

export async function getNextSequence(sessionId: string): Promise<number> {
  const result = await getDb()
    .select({
      value: max(messages.seq),
    })
    .from(messages)
    .where(eq(messages.session_id, sessionId));

  return (result[0]?.value ?? 0) + 1;
}

export async function appendMessage(input: AppendMessageInput): Promise<void> {
  const createdAt = input.created_at ?? Date.now();
  const seq = await getNextSequence(input.session_id);

  await getDb()
    .insert(messages)
    .values({
      id: input.id,
      session_id: input.session_id,
      role: input.role,
      kind: input.kind ?? "message",
      content: input.content,
      seq,
      created_at: createdAt,
    });

  await touchSession({
    id: input.session_id,
    updated_at: createdAt,
    last_message_at: createdAt,
  });
}

export async function getMessages(sessionId: string) {
  const rows = await getDb().query.messages.findMany({
    where: eq(messages.session_id, sessionId),
    orderBy: [asc(messages.seq)],
  });

  return rows.filter((row) => row.kind !== "model_message");
}

export async function replaceMessages(
  sessionId: string,
  nextMessages: ModelMessage[],
): Promise<void> {
  const createdAt = Date.now();
  const db = getDb();

  await db.delete(model_messages).where(eq(model_messages.session_id, sessionId));
  if (nextMessages.length > 0) {
    await db.insert(model_messages).values(
      nextMessages.map((message, index) => ({
        id: `${sessionId}_msg_${index + 1}`,
        session_id: sessionId,
        role: message.role,
        content: JSON.stringify(message.content),
        seq: index + 1,
        created_at: createdAt + index,
      })),
    );
  }

  await touchSession({
    id: sessionId,
    updated_at: createdAt,
    last_message_at: nextMessages.length > 0 ? createdAt + nextMessages.length - 1 : null,
  });
}

export async function loadModelMessages(sessionId: string): Promise<ModelMessage[]> {
  const rows = await getDb().query.model_messages.findMany({
    where: eq(model_messages.session_id, sessionId),
    orderBy: [asc(model_messages.seq)],
  });

  return rows.map(
    (row) =>
      ({
        role: row.role,
        content: JSON.parse(row.content),
      }) as ModelMessage,
  );
}

export async function loadEffectiveModelMessages(sessionId: string): Promise<ModelMessage[]> {
  const [messages, artifact] = await Promise.all([
    loadModelMessages(sessionId),
    loadLatestCompactContinuationArtifact(sessionId),
  ]);

  if (!artifact) {
    return messages;
  }

  const artifactText = [
    "Continuation brief from compacted prior session context:",
    `Summary: ${artifact.summary.trim() || "(none)"}`,
    `Critical files: ${artifact.criticalFiles.length > 0 ? artifact.criticalFiles.join(", ") : "(none)"}`,
    `Open risks: ${artifact.openRisks.length > 0 ? artifact.openRisks.join(" | ") : "(none)"}`,
  ].join("\n");

  const first = messages[0];
  if (
    first?.role === "system" &&
    typeof first.content === "string" &&
    first.content.includes("Continuation brief from compacted prior session context:")
  ) {
    return messages;
  }

  return [
    {
      role: "system",
      content: artifactText,
    },
    ...messages,
  ];
}

const DEFAULT_PRUNE_PROTECT_TOKENS = 10_000;
const DEFAULT_PRUNE_MINIMUM_TOKENS = 5_000;
const DEFAULT_RECENT_ASSISTANT_MESSAGES_TO_KEEP = 2;
const PRUNED_TRANSCRIPT_PREFIX = "[pruned-transcript]";
const COMPACT_ARTIFACT_KIND = "compact_artifact";
const COMPACTION_EVENT_KIND = "compaction_event";

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

export async function pruneSessionTranscripts(input: {
  sessionId: string;
  protectTokens?: number;
  minimumTokens?: number;
  keepRecentAssistantMessages?: number;
  estimateTokens?: (text: string) => number;
}): Promise<number> {
  const protectTokens = input.protectTokens ?? DEFAULT_PRUNE_PROTECT_TOKENS;
  const minimumTokens = input.minimumTokens ?? DEFAULT_PRUNE_MINIMUM_TOKENS;
  const keepRecentAssistantMessages =
    input.keepRecentAssistantMessages ?? DEFAULT_RECENT_ASSISTANT_MESSAGES_TO_KEEP;
  const estimateTokens = input.estimateTokens ?? estimateTextTokens;

  const rows = await getDb().query.messages.findMany({
    where: eq(messages.session_id, input.sessionId),
    orderBy: [asc(messages.seq)],
  });

  let seenAssistantMessages = 0;
  let retainedTokens = 0;
  let prunedTokens = 0;
  const rowsToPrune: Array<{ id: string; nextContent: string }> = [];

  for (const row of [...rows].reverse()) {
    if (row.role !== "assistant" || row.kind !== "transcript") {
      continue;
    }

    seenAssistantMessages += 1;
    if (seenAssistantMessages <= keepRecentAssistantMessages) {
      retainedTokens += estimateTokens(row.content);
      continue;
    }

    if (row.content.startsWith(PRUNED_TRANSCRIPT_PREFIX)) {
      continue;
    }

    const rowTokens = estimateTokens(row.content);
    retainedTokens += rowTokens;
    if (retainedTokens <= protectTokens) {
      continue;
    }

    const nextContent = `${PRUNED_TRANSCRIPT_PREFIX} Assistant transcript omitted to reduce session context pressure. Original length=${row.content.length} chars.`;
    prunedTokens += Math.max(0, rowTokens - estimateTokens(nextContent));
    rowsToPrune.push({ id: row.id, nextContent });
  }

  if (prunedTokens < minimumTokens || rowsToPrune.length === 0) {
    return 0;
  }

  const db = getDb();
  for (const row of rowsToPrune) {
    await db
      .update(messages)
      .set({ content: row.nextContent })
      .where(and(eq(messages.id, row.id), eq(messages.session_id, input.sessionId)));
  }

  await touchSession({
    id: input.sessionId,
    updated_at: Date.now(),
  });

  return rowsToPrune.length;
}

export async function saveCompactContinuationArtifact(input: {
  sessionId: string;
  artifact: CompactContinuationArtifact;
}): Promise<void> {
  await appendMessage({
    id: `${input.sessionId}_compact_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    session_id: input.sessionId,
    role: "assistant",
    kind: COMPACT_ARTIFACT_KIND,
    content: JSON.stringify(input.artifact),
    created_at: input.artifact.createdAt,
  });
}

export async function saveCompactionEvent(input: {
  sessionId: string;
  event: CompactionEventRecord;
}): Promise<void> {
  await appendMessage({
    id: `${input.sessionId}_compaction_event_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    session_id: input.sessionId,
    role: "system",
    kind: COMPACTION_EVENT_KIND,
    content: JSON.stringify(input.event),
    created_at: input.event.createdAt,
  });
}

export async function loadCompactionEvents(sessionId: string): Promise<CompactionEventRecord[]> {
  const rows = await getDb().query.messages.findMany({
    where: eq(messages.session_id, sessionId),
    orderBy: [asc(messages.seq)],
  });

  return rows.flatMap((row) => {
    if (row.kind !== COMPACTION_EVENT_KIND) {
      return [];
    }

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
    } catch {
      return [];
    }

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
    if (row.kind !== COMPACT_ARTIFACT_KIND) {
      continue;
    }

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

export async function estimateSessionTranscriptPressure(input: {
  sessionId: string;
  keepRecentAssistantMessages?: number;
  estimateTokens?: (text: string) => number;
}): Promise<{
  assistantTranscriptCount: number;
  retainedTokens: number;
  prunableTokens: number;
}> {
  const keepRecentAssistantMessages =
    input.keepRecentAssistantMessages ?? DEFAULT_RECENT_ASSISTANT_MESSAGES_TO_KEEP;
  const estimateTokens = input.estimateTokens ?? estimateTextTokens;

  const rows = await getDb().query.messages.findMany({
    where: eq(messages.session_id, input.sessionId),
    orderBy: [asc(messages.seq)],
  });

  let seenAssistantMessages = 0;
  let retainedTokens = 0;
  let prunableTokens = 0;

  for (const row of [...rows].reverse()) {
    if (row.role !== "assistant" || row.kind !== "transcript") {
      continue;
    }

    seenAssistantMessages += 1;
    if (row.content.startsWith(PRUNED_TRANSCRIPT_PREFIX)) {
      continue;
    }

    const rowTokens = estimateTokens(row.content);
    retainedTokens += rowTokens;
    if (seenAssistantMessages > keepRecentAssistantMessages) {
      prunableTokens += rowTokens;
    }
  }

  return {
    assistantTranscriptCount: seenAssistantMessages,
    retainedTokens,
    prunableTokens,
  };
}

export async function buildCompactContinuationArtifact(input: {
  sessionId: string;
  keepRecentAssistantMessages?: number;
  builder?: (content: string) => Promise<{
    summary: string;
    criticalFiles: string[];
    openRisks: string[];
  } | null>;
}): Promise<CompactContinuationArtifact | null> {
  const keepRecentAssistantMessages =
    input.keepRecentAssistantMessages ?? DEFAULT_RECENT_ASSISTANT_MESSAGES_TO_KEEP;

  const rows = await getDb().query.messages.findMany({
    where: eq(messages.session_id, input.sessionId),
    orderBy: [asc(messages.seq)],
  });

  let seenAssistantMessages = 0;
  const prunableSegments: string[] = [];

  for (const row of [...rows].reverse()) {
    if (row.role !== "assistant" || row.kind !== "transcript") {
      continue;
    }

    seenAssistantMessages += 1;
    if (seenAssistantMessages <= keepRecentAssistantMessages) {
      continue;
    }

    if (row.content.startsWith(PRUNED_TRANSCRIPT_PREFIX)) {
      continue;
    }

    prunableSegments.push(row.content);
  }

  if (prunableSegments.length === 0) {
    return null;
  }

  const combined = prunableSegments.reverse().join("\n\n");
  const built = (await input.builder?.(combined)) ?? {
    summary: summarizeTranscript(combined),
    criticalFiles: extractLikelyFiles(combined).slice(0, 12),
    openRisks: extractLikelyRisks(combined).slice(0, 8),
  };

  return {
    summary: built.summary,
    criticalFiles: built.criticalFiles,
    openRisks: built.openRisks,
    source: "preturn-prune",
    createdAt: Date.now(),
  };
}

function summarizeTranscript(content: string): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 1200) {
    return cleaned;
  }
  return `${cleaned.slice(0, 1200)}...`;
}

function extractLikelyFiles(content: string): string[] {
  const matches = content.match(/\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\b/g) ?? [];
  return Array.from(new Set(matches)).filter((value) => /[/.]/.test(value));
}

function extractLikelyRisks(content: string): string[] {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const riskLines = lines.filter((line) =>
    /(fail|error|risk|todo|follow-up|follow up|unknown|uncertain|blocked|warning)/i.test(line),
  );
  return Array.from(
    new Set(riskLines.map((line) => (line.length > 220 ? `${line.slice(0, 220)}...` : line))),
  );
}

const MODEL_MESSAGE_PROTECT_TOKENS = 12_500;
const MODEL_MESSAGE_MINIMUM_PRUNE_TOKENS = 5_000;
const MODEL_MESSAGE_RECENT_TO_KEEP = 12;

export async function pruneModelMessagesWithArtifact(input: {
  sessionId: string;
  protectTokens?: number;
  minimumPruneTokens?: number;
  keepRecentMessages?: number;
  estimateModelMessageTokens?: (message: ModelMessage) => number;
}): Promise<{
  pruned: boolean;
  removedCount: number;
}> {
  const protectTokens = input.protectTokens ?? MODEL_MESSAGE_PROTECT_TOKENS;
  const minimumPruneTokens = input.minimumPruneTokens ?? MODEL_MESSAGE_MINIMUM_PRUNE_TOKENS;
  const keepRecentMessages = input.keepRecentMessages ?? MODEL_MESSAGE_RECENT_TO_KEEP;
  const estimateMessageTokens = input.estimateModelMessageTokens ?? estimateModelMessageTokens;

  const [rawMessages, artifact] = await Promise.all([
    loadModelMessages(input.sessionId),
    loadLatestCompactContinuationArtifact(input.sessionId),
  ]);

  if (rawMessages.length <= keepRecentMessages) {
    return { pruned: false, removedCount: 0 };
  }

  const recent = rawMessages.slice(-keepRecentMessages);
  const older = rawMessages.slice(0, -keepRecentMessages);
  const olderTokens = older.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  const recentTokens = recent.reduce((sum, message) => sum + estimateMessageTokens(message), 0);

  if (olderTokens < minimumPruneTokens && recentTokens < protectTokens) {
    return { pruned: false, removedCount: 0 };
  }

  let nextMessages = recent;
  if (artifact) {
    const artifactSystemMessage: ModelMessage = {
      role: "system",
      content: [
        "Continuation brief from compacted prior session context:",
        `Summary: ${artifact.summary.trim() || "(none)"}`,
        `Critical files: ${artifact.criticalFiles.length > 0 ? artifact.criticalFiles.join(", ") : "(none)"}`,
        `Open risks: ${artifact.openRisks.length > 0 ? artifact.openRisks.join(" | ") : "(none)"}`,
      ].join("\n"),
    };

    const first = nextMessages[0];
    if (
      !(
        first?.role === "system" &&
        typeof first.content === "string" &&
        first.content.includes("Continuation brief from compacted prior session context:")
      )
    ) {
      nextMessages = [artifactSystemMessage, ...nextMessages];
    }
  }

  await replaceMessages(input.sessionId, nextMessages);

  return {
    pruned: true,
    removedCount: older.length,
  };
}

function estimateModelMessageTokens(message: ModelMessage): number {
  return estimateTextTokens(modelMessageToText(message));
}

function modelMessageToText(message: ModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  try {
    return JSON.stringify(message.content);
  } catch {
    return String(message.content);
  }
}

function estimateTextTokens(text: string): number {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }

  return Math.ceil(normalized.length / 4);
}
