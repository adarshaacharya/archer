import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { messages } from "./schema.js";
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
  return getDb().query.messages.findMany({
    where: eq(messages.session_id, sessionId),
    orderBy: [asc(messages.seq)],
  });
}
