import { asc, eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { touchSession } from "./session.js";
import { turn_results } from "./schema.js";

export type PersistedTurnResult = {
  id: string;
  sessionId: string;
  turnKind?: "user" | "compact" | "commit";
  intent: string;
  status: string;
  task: string;
  summary?: unknown;
  message?: string;
  createdAt?: number;
};

export async function appendTurnResult(input: PersistedTurnResult): Promise<void> {
  const createdAt = input.createdAt ?? Date.now();
  await getDb()
    .insert(turn_results)
    .values({
      id: input.id,
      session_id: input.sessionId,
      turn_kind: input.turnKind ?? "user",
      intent: input.intent,
      status: input.status,
      task: input.task,
      summary_json: input.summary === undefined ? null : JSON.stringify(input.summary),
      message: input.message ?? null,
      created_at: createdAt,
    });

  await touchSession({
    id: input.sessionId,
    updated_at: createdAt,
    last_message_at: createdAt,
  });
}

export async function getTurnResults(sessionId: string, limit?: number) {
  const rows = await getDb().query.turn_results.findMany({
    where: eq(turn_results.session_id, sessionId),
    orderBy: [asc(turn_results.created_at)],
  });

  const sliced = limit && limit > 0 ? rows.slice(-limit) : rows;

  return sliced.map((row) => ({
    ...row,
    turnKind: row.turn_kind,
    summary:
      row.summary_json == null
        ? null
        : (() => {
            try {
              return JSON.parse(row.summary_json);
            } catch {
              return null;
            }
          })(),
  }));
}
