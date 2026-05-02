import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.js";

const STORAGE_DIR =
  process.env.XEQ_STORAGE_DIR ?? path.join(os.homedir(), ".local", "share", "xeq");
const DATABASE_PATH = process.env.XEQ_DATABASE_PATH ?? path.join(STORAGE_DIR, "history.db");

let sqlite: Database | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let initialized = false;

const STORAGE_SCHEMA_VERSION = 1;

type SqliteMasterRow = {
  type: string;
  name: string;
};

export type StorageBootstrapStatus = {
  databasePath: string;
  schemaVersion: number;
  created: string[];
  alreadyPresent: string[];
};

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

  const bootstrap = bootstrapStorage(database);
  if (bootstrap.created.length > 0) {
    database.exec(`PRAGMA user_version = ${STORAGE_SCHEMA_VERSION};`);
  }

  initialized = true;
}

function bootstrapStorage(database: Database): StorageBootstrapStatus {
  const existingRows = database
    .query<SqliteMasterRow, []>(
      "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index')",
    )
    .all();
  const existing = new Set(existingRows.map((row) => `${row.type}:${row.name}`));

  const objects = [
    {
      key: "table:sessions",
      sql: `CREATE TABLE sessions (
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
    )`,
    },
    {
      key: "index:sessions_updated_at_idx",
      sql: `CREATE INDEX sessions_updated_at_idx ON sessions(updated_at)`,
    },
    {
      key: "index:sessions_project_root_idx",
      sql: `CREATE INDEX sessions_project_root_idx ON sessions(project_root)`,
    },
    {
      key: "table:messages",
      sql: `CREATE TABLE messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      seq INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    },
    {
      key: "index:messages_session_id_created_at_idx",
      sql: `CREATE INDEX messages_session_id_created_at_idx
      ON messages(session_id, created_at)`,
    },
    {
      key: "index:messages_session_id_seq_idx",
      sql: `CREATE UNIQUE INDEX messages_session_id_seq_idx
      ON messages(session_id, seq)`,
    },
    {
      key: "table:model_messages",
      sql: `CREATE TABLE model_messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      seq INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    },
    {
      key: "index:model_messages_session_id_created_at_idx",
      sql: `CREATE INDEX model_messages_session_id_created_at_idx
      ON model_messages(session_id, created_at)`,
    },
    {
      key: "index:model_messages_session_id_seq_idx",
      sql: `CREATE UNIQUE INDEX model_messages_session_id_seq_idx
      ON model_messages(session_id, seq)`,
    },
    {
      key: "table:turn_results",
      sql: `CREATE TABLE turn_results (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      intent TEXT NOT NULL,
      status TEXT NOT NULL,
      task TEXT NOT NULL,
      summary_json TEXT,
      message TEXT,
      created_at INTEGER NOT NULL
    )`,
    },
    {
      key: "index:turn_results_session_id_created_at_idx",
      sql: `CREATE INDEX turn_results_session_id_created_at_idx
      ON turn_results(session_id, created_at)`,
    },
  ];

  const created: string[] = [];
  const alreadyPresent: string[] = [];

  for (const object of objects) {
    if (existing.has(object.key)) {
      alreadyPresent.push(object.key);
      continue;
    }

    database.exec(object.sql);
    created.push(object.key);
  }

  return {
    databasePath: DATABASE_PATH,
    schemaVersion: STORAGE_SCHEMA_VERSION,
    created,
    alreadyPresent,
  };
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

export function ensureStorageBootstrap(): StorageBootstrapStatus {
  const database = getSqlite();
  const status = bootstrapStorage(database);
  if (status.created.length > 0) {
    database.exec(`PRAGMA user_version = ${STORAGE_SCHEMA_VERSION};`);
  }
  return status;
}

export function resetStorageForTests(): void {
  if (sqlite) {
    sqlite.close();
  }
  sqlite = null;
  db = null;
  initialized = false;
}
