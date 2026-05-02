import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.js";

const STORAGE_DIR = path.join(os.homedir(), ".local", "share", "xeq");
const DATABASE_PATH = path.join(STORAGE_DIR, "history.db");

let sqlite: Database | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let initialized = false;

export function getStorageDir(): string {
  return STORAGE_DIR;
}

export function getDatabasePath(): string {
  return DATABASE_PATH;
}

export function ensureStorageDir(): string {
  mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o700 });
  return STORAGE_DIR;
}

export function getSqlite(): Database {
  if (sqlite) {
    return sqlite;
  }

  ensureStorageDir();
  sqlite = new Database(DATABASE_PATH, { create: true, strict: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return sqlite;
}

function initSchema(database: Database): void {
  if (initialized) {
    return;
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT,
      cwd TEXT NOT NULL,
      project_root TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_message_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS sessions_updated_at_idx ON sessions(updated_at);
    CREATE INDEX IF NOT EXISTS sessions_project_root_idx ON sessions(project_root);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      seq INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS messages_session_id_created_at_idx
      ON messages(session_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS messages_session_id_seq_idx
      ON messages(session_id, seq);

    CREATE TABLE IF NOT EXISTS model_messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      seq INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS model_messages_session_id_created_at_idx
      ON model_messages(session_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS model_messages_session_id_seq_idx
      ON model_messages(session_id, seq);

    CREATE TABLE IF NOT EXISTS turn_results (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      intent TEXT NOT NULL,
      status TEXT NOT NULL,
      task TEXT NOT NULL,
      summary_json TEXT,
      message TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS turn_results_session_id_created_at_idx
      ON turn_results(session_id, created_at);
  `);

  initialized = true;
}

export function getDb() {
  if (db) {
    return db;
  }

  const database = getSqlite();
  initSchema(database);
  db = drizzle(database, { schema });
  return db;
}
