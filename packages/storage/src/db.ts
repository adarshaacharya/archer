import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.js";

const STORAGE_DIR =
  process.env.ARCHER_STORAGE_DIR ?? path.join(os.homedir(), ".local", "share", "archer");
const DATABASE_PATH = process.env.ARCHER_DATABASE_PATH ?? path.join(STORAGE_DIR, "history.db");
const MIGRATIONS_DIR = path.join(import.meta.dir, "..", "migrations");

let sqlite: Database | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let initialized = false;

type SqliteObjectRow = {
  type: string;
  name: string;
};

type MigrationJournal = {
  entries: Array<{
    idx: number;
    tag: string;
    when: number;
  }>;
};

export type StorageBootstrapStatus = {
  databasePath: string;
  baselineApplied: string[];
  migrationTableCreated: boolean;
  migrationsApplied: string[];
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

  bootstrapStorage(database);
  applySqlMigrations(database);

  initialized = true;
}

function bootstrapStorage(database: Database): StorageBootstrapStatus {
  const existingRows = database
    .query<SqliteObjectRow, []>(
      "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index')",
    )
    .all();
  const existing = new Set(existingRows.map((row) => `${row.type}:${row.name}`));
  const migrationTableKey = "table:__drizzle_migrations";
  const baselineApplied: string[] = [];
  const hasLegacyBaseSchema =
    existing.has("table:sessions") &&
    existing.has("table:messages") &&
    existing.has("table:model_messages");
  const hasTurnResults =
    existing.has("table:turn_results") &&
    existing.has("index:turn_results_session_id_created_at_idx");
  let migrationTableCreated = false;

  if (!existing.has(migrationTableKey) && hasLegacyBaseSchema) {
    ensureMigrationTable(database);
    migrationTableCreated = true;
  }

  const appliedHashes = appliedMigrationHashes(database);

  if (hasLegacyBaseSchema && appliedHashes.size === 0) {
    const legacyInitTag = "0000_legacy_init";
    database
      .query('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)')
      .run(migrationHashForTag(legacyInitTag), Date.now());
    baselineApplied.push(legacyInitTag);

    if (hasTurnResults) {
      const turnResultsTag = "0001_add_turn_results";
      database
        .query('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)')
        .run(migrationHashForTag(turnResultsTag), Date.now());
      baselineApplied.push(turnResultsTag);
    }
  }

  return {
    databasePath: DATABASE_PATH,
    baselineApplied,
    migrationTableCreated,
    migrationsApplied: [],
  };
}

function migrationHashForTag(tag: string): string {
  const filePath = path.join(MIGRATIONS_DIR, `${tag}.sql`);
  const sql = readFileSync(filePath, "utf8");
  return createHash("sha256").update(sql).digest("hex");
}

function ensureMigrationTable(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )`);
}

function appliedMigrationHashes(database: Database): Set<string> {
  const migrationTableExists = database
    .query<SqliteObjectRow, []>(
      `SELECT type, name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`,
    )
    .all().length > 0;
  if (!migrationTableExists) {
    return new Set();
  }

  const rows = database
    .query<{ hash: string }, []>('SELECT hash FROM "__drizzle_migrations"')
    .all();
  return new Set(rows.map((row) => row.hash));
}

function loadMigrationJournal(): MigrationJournal {
  const filePath = path.join(MIGRATIONS_DIR, "meta", "_journal.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as MigrationJournal;
}

function applySqlMigrations(database: Database): string[] {
  ensureMigrationTable(database);
  const appliedHashes = appliedMigrationHashes(database);
  const journal = loadMigrationJournal();
  const appliedTags: string[] = [];

  for (const entry of journal.entries.sort((left, right) => left.idx - right.idx)) {
    const hash = migrationHashForTag(entry.tag);
    if (appliedHashes.has(hash)) {
      continue;
    }

    const sql = readFileSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      database.exec(statement);
    }

    database
      .query('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)')
      .run(hash, entry.when);
    appliedHashes.add(hash);
    appliedTags.push(entry.tag);
  }

  return appliedTags;
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
  const migrationsApplied = applySqlMigrations(database);
  return {
    ...status,
    migrationsApplied,
  };
}

export function resetStorageForTests(): void {
  if (sqlite) {
    sqlite.close();
  }
  sqlite = null;
  db = null;
  initialized = false;
}
