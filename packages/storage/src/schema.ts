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

export const model_messages = sqliteTable(
  "model_messages",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    seq: integer("seq", { mode: "number" }).notNull(),
    created_at: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("model_messages_session_id_created_at_idx").on(table.session_id, table.created_at),
    uniqueIndex("model_messages_session_id_seq_idx").on(table.session_id, table.seq),
  ],
);

export const turn_results = sqliteTable(
  "turn_results",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    turn_kind: text("turn_kind").notNull().default("user"),
    intent: text("intent").notNull(),
    status: text("status").notNull(),
    task: text("task").notNull(),
    summary_json: text("summary_json"),
    message: text("message"),
    created_at: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("turn_results_session_id_created_at_idx").on(table.session_id, table.created_at),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type ModelMessageRow = typeof model_messages.$inferSelect;
export type NewModelMessageRow = typeof model_messages.$inferInsert;
export type TurnResultRow = typeof turn_results.$inferSelect;
export type NewTurnResultRow = typeof turn_results.$inferInsert;
