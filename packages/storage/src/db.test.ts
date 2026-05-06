import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { ensureStorageBootstrap, getDatabasePath, resetStorageForTests } from "./index.js";

afterEach(() => {
  resetStorageForTests();
  rmSync(getDatabasePath(), { force: true });
  rmSync(`${getDatabasePath()}-shm`, { force: true });
  rmSync(`${getDatabasePath()}-wal`, { force: true });
});

describe("storage bootstrap", () => {
  test("baselines an older history database and applies newer migrations", () => {
    rmSync(getDatabasePath(), { force: true });
    rmSync(`${getDatabasePath()}-shm`, { force: true });
    rmSync(`${getDatabasePath()}-wal`, { force: true });
    const db = new Database(getDatabasePath(), { create: true, strict: true });
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(`
      CREATE TABLE sessions (
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

      CREATE INDEX sessions_updated_at_idx ON sessions(updated_at);
      CREATE INDEX sessions_project_root_idx ON sessions(project_root);

      CREATE TABLE messages (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        seq INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX messages_session_id_created_at_idx
        ON messages(session_id, created_at);
      CREATE UNIQUE INDEX messages_session_id_seq_idx
        ON messages(session_id, seq);

      CREATE TABLE model_messages (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        seq INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX model_messages_session_id_created_at_idx
        ON model_messages(session_id, created_at);
      CREATE UNIQUE INDEX model_messages_session_id_seq_idx
        ON model_messages(session_id, seq);
    `);
    db.close();

    const status = ensureStorageBootstrap();

    expect(status.migrationTableCreated).toBe(true);
    expect(status.baselineApplied).toContain("0000_legacy_init");

    const verifyDb = new Database(getDatabasePath(), { create: false, strict: true });
    const rows = verifyDb
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'turn_results'",
      )
      .all();
    const migrationRows = verifyDb
      .query<{ hash: string }, []>('SELECT hash FROM "__drizzle_migrations"')
      .all();
    verifyDb.close();

    expect(rows).toHaveLength(1);
    expect(migrationRows).toHaveLength(2);
  });
});
