import initSqlJs, { type Database } from "sql.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DbDriver, SqlValue } from "../src/lib/db/driver";
import { setDb } from "../src/lib/db";

const MIGRATIONS_DIR = fileURLToPath(new URL("../src-tauri/migrations/", import.meta.url));

/** `$1` → `?1` so sql.js binds by explicit index, matching sqlx semantics. */
const toSqlJs = (sql: string) => sql.replace(/\$(\d+)/g, "?$1");

/**
 * Creates an in-memory database with every production migration applied
 * and installs it as the active driver.
 */
export async function createTestDb(opts: { upTo?: number } = {}): Promise<DbDriver & { raw: Database }> {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  raw.run("PRAGMA foreign_keys = ON;");
  for (const file of migrationFiles().filter((f) => opts.upTo == null || parseInt(f, 10) <= opts.upTo)) {
    raw.run(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  const driver = {
    raw,
    async execute(sql: string, params: SqlValue[] = []) {
      raw.run(toSqlJs(sql), params);
      return { rowsAffected: raw.getRowsModified() };
    },
    async select<T>(sql: string, params: SqlValue[] = []) {
      const stmt = raw.prepare(toSqlJs(sql));
      try {
        stmt.bind(params);
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },
  };
  setDb(driver);
  return driver;
}

const migrationFiles = () => readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

/** Applies one migration (by version number) to a test database, e.g. to test upgrading existing data. */
export function runMigration(db: { raw: Database }, version: number): void {
  const file = migrationFiles().find((f) => parseInt(f, 10) === version);
  if (!file) throw new Error(`No migration ${version}`);
  db.raw.run(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}
