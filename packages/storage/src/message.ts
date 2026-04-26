import type { ModelMessage } from "ai";
import { asc, eq, max } from "drizzle-orm";
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
