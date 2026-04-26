import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    title: text("title"),
    cwd: text("cwd").notNull(),
    project_root: text("project_root").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull(),
    created_at: integer("created_at", { mode: "number" }).notNull(),
    updated_at: integer("updated_at", { mode: "number" }).notNull(),
    last_message_at: integer("last_message_at", { mode: "number" }),
  },
  (table) => [
    index("sessions_updated_at_idx").on(table.updated_at),
    index("sessions_project_root_idx").on(table.project_root),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    seq: integer("seq", { mode: "number" }).notNull(),
    created_at: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("messages_session_id_created_at_idx").on(table.session_id, table.created_at),
    uniqueIndex("messages_session_id_seq_idx").on(table.session_id, table.seq),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
