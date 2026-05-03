import { asc, eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { prompt_history } from "./schema.js";

export type PersistedPromptHistoryEntry = {
  id: string;
  projectRoot: string;
  sessionId?: string | null;
  text: string;
  createdAt?: number;
};

export async function appendPromptHistoryEntry(input: PersistedPromptHistoryEntry): Promise<void> {
  const createdAt = input.createdAt ?? Date.now();
  await getDb().insert(prompt_history).values({
    id: input.id,
    project_root: input.projectRoot,
    session_id: input.sessionId ?? null,
    text: input.text,
    created_at: createdAt,
  });
}

export async function listPromptHistory(projectRoot: string, limit = 100): Promise<string[]> {
  const rows = await getDb().query.prompt_history.findMany({
    where: eq(prompt_history.project_root, projectRoot),
    orderBy: [asc(prompt_history.created_at)],
  });

  return rows.slice(-limit).map((row) => row.text);
}
