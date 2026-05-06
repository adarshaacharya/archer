import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { type NewSessionRow, sessions } from "./schema.js";

export type CreateSessionInput = {
  id: string;
  title?: string | null;
  cwd: string;
  project_root: string;
  provider: string;
  model: string;
  status?: string;
  created_at?: number;
};

export async function createSession(input: CreateSessionInput): Promise<void> {
  const now = input.created_at ?? Date.now();
  const row: NewSessionRow = {
    id: input.id,
    title: input.title ?? null,
    cwd: input.cwd,
    project_root: input.project_root,
    provider: input.provider,
    model: input.model,
    status: input.status ?? "active",
    created_at: now,
    updated_at: now,
    last_message_at: null,
  };

  await getDb().insert(sessions).values(row);
}

export async function getSession(id: string) {
  return getDb().query.sessions.findFirst({
    where: eq(sessions.id, id),
  });
}

export async function deleteSession(id: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.id, id));
}

export async function listSessions(opts?: { limit?: number; project_root?: string }) {
  return getDb().query.sessions.findMany({
    where: opts?.project_root ? eq(sessions.project_root, opts.project_root) : undefined,
    orderBy: [desc(sessions.updated_at)],
    limit: opts?.limit,
  });
}

export async function touchSession(input: {
  id: string;
  updated_at?: number;
  last_message_at?: number | null;
  status?: string;
}): Promise<void> {
  const now = input.updated_at ?? Date.now();
  await getDb()
    .update(sessions)
    .set({
      updated_at: now,
      last_message_at: input.last_message_at ?? now,
      status: input.status,
    })
    .where(eq(sessions.id, input.id));
}

export async function updateSessionTitle(input: { id: string; title: string }): Promise<void> {
  await getDb()
    .update(sessions)
    .set({
      title: input.title,
      updated_at: Date.now(),
    })
    .where(eq(sessions.id, input.id));
}
