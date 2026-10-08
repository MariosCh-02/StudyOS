import { invoke } from "@tauri-apps/api/core";
import { DatabaseError, type DbDriver, type SqlValue } from "./driver";

/**
 * Database access through StudyOS's own Rust commands (src-tauri/src/db.rs),
 * which accept one SELECT / INSERT / UPDATE / DELETE statement at a time.
 * Migrations are applied by the Rust side at start-up.
 */
export async function createTauriDriver(): Promise<DbDriver> {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new DatabaseError(
      "StudyOS is open in a web browser. Your data can only be opened from the StudyOS desktop window. " +
        "Close this tab and use the window started by `npm run tauri dev` (or the installed app).",
    );
  }
  try {
    await invoke("db_select", { sql: "SELECT 1", params: [] });
  } catch (err) {
    throw new DatabaseError("Could not open the StudyOS database.", err);
  }
  return {
    async execute(sql: string, params: SqlValue[] = []) {
      try {
        return await invoke<{ rowsAffected: number }>("db_execute", { sql, params });
      } catch (err) {
        throw new DatabaseError(describe(err), err);
      }
    },
    async select<T>(sql: string, params: SqlValue[] = []) {
      try {
        return await invoke<T[]>("db_select", { sql, params });
      } catch (err) {
        throw new DatabaseError(describe(err), err);
      }
    },
  };
}

function describe(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : "Database operation failed.";
}
