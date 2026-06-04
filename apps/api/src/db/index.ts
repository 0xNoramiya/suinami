/**
 * SQLite connection + Drizzle wrapper for the Suinami indexer rollups.
 *
 * On boot we open the better-sqlite3 file and run CREATE TABLE IF NOT EXISTS
 * for every table inline, so a brand-new database works with no migration
 * step. This is purely local I/O — no network — keeping startup boot-safe.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../env";
import * as schema from "./schema";
import { CREATE_TABLE_STATEMENTS } from "./schema";

/** Raw better-sqlite3 handle (exported for prepared statements / pragmas). */
export const sqlite: Database.Database = (() => {
  try {
    const handle = new Database(env.DATABASE_URL);
    // WAL gives us concurrent reads while the indexer writes. Local-only.
    handle.pragma("journal_mode = WAL");
    handle.pragma("foreign_keys = ON");
    return handle;
  } catch (err) {
    console.error(
      `[db] failed to open SQLite at ${env.DATABASE_URL}:`,
      err,
    );
    throw err;
  }
})();

/** Drizzle ORM instance bound to the schema. */
export const db = drizzle(sqlite, { schema });

/**
 * Create every table/index if it doesn't exist. Idempotent — safe to call on
 * every boot. Runs synchronously before the server starts serving requests.
 */
export function ensureSchema(): void {
  const apply = sqlite.transaction(() => {
    for (const statement of CREATE_TABLE_STATEMENTS) {
      sqlite.exec(statement);
    }
    // Idempotent column additions for databases created before a column existed
    // (CREATE TABLE IF NOT EXISTS won't alter an existing table). Guarded by
    // PRAGMA so re-running is a no-op.
    addColumnIfMissing("creator_stats", "display_name", "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing("creator_stats", "bio", "TEXT NOT NULL DEFAULT ''");
  });
  apply();
}

/** Add `<table>.<column> <typeDdl>` only when the column is absent. */
function addColumnIfMissing(table: string, column: string, typeDdl: string): void {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDdl}`);
  }
}

// Run schema creation immediately on import so the module is ready to use.
ensureSchema();

export { schema };
