/**
 * Two-way sync between the local SQLite database and a per-user cloud store.
 *
 * Model
 *   - Every synced row has a stable id and an `updated_at` timestamp; deletions
 *     are soft (`deleted_at`), so they travel as ordinary updates.
 *   - `sync_rows` remembers the last version known to match the cloud. A local
 *     row whose `updated_at` differs from it has unsynced changes.
 *   - Conflicts resolve last-writer-wins on `updated_at`.
 *   - Pull is incremental using a per-table server-time watermark.
 */
import type { DbDriver, SqlValue } from "@/lib/db/driver";

export type RowData = Record<string, SqlValue>;

export interface RemoteRow {
  id: string;
  data: RowData;
  /** Server-assigned time the row was last written to the cloud, in ms. */
  syncedAtMs: number;
}

export interface RemoteStore {
  /** Rows written after `sinceMs`, ordered by `syncedAtMs` ascending. */
  pull(table: string, sinceMs: number): Promise<RemoteRow[]>;
  push(table: string, rows: { id: string; data: RowData }[]): Promise<void>;
}

interface SyncTable {
  name: string;
  pk: string;
}

/**
 * Synced tables in dependency order (parents before children).
 * Tags join the list when user-defined tagging ships (Phase 6).
 */
export const SYNC_TABLES: SyncTable[] = [
  { name: "user_profile", pk: "id" },
  { name: "settings", pk: "key" },
  { name: "institutions", pk: "id" },
  { name: "programmes", pk: "id" },
  { name: "academic_years", pk: "id" },
  { name: "semesters", pk: "id" },
  { name: "courses", pk: "id" },
  // Learning content before projects: a project can be started from a lesson.
  { name: "topics", pk: "id" },
  { name: "learning_tracks", pk: "id" },
  { name: "subjects", pk: "id" },
  { name: "lessons", pk: "id" },
  { name: "projects", pk: "id" },
  { name: "papers", pk: "id" },
  { name: "lectures", pk: "id" },
  { name: "notes", pk: "id" },
  { name: "attachments", pk: "id" }, // metadata only; files stay on the importing device
  { name: "note_templates", pk: "id" },
  { name: "recurring_events", pk: "id" },
  { name: "recurrence_exceptions", pk: "id" },
  { name: "calendar_events", pk: "id" },
  { name: "assignments", pk: "id" },
  { name: "exams", pk: "id" },
  { name: "tasks", pk: "id" },
  { name: "attendance", pk: "id" },
  { name: "study_sessions", pk: "id" },
  { name: "questions", pk: "id" },
  { name: "quiz_sessions", pk: "id" },
  { name: "question_attempts", pk: "id" },
  { name: "flashcards", pk: "id" },
  { name: "flashcard_reviews", pk: "id" },
  { name: "srs_state", pk: "id" },
  { name: "formulas", pk: "id" },
  { name: "diagnostics", pk: "id" },
  { name: "tags", pk: "id" },
  { name: "tag_links", pk: "id" },
  { name: "knowledge_entries", pk: "id" },
  { name: "knowledge_links", pk: "id" },
  { name: "project_milestones", pk: "id" },
  { name: "project_papers", pk: "id" },
];

const PUSH_CHUNK = 400;

const columnCache = new WeakMap<DbDriver, Map<string, string[]>>();

async function columnsOf(db: DbDriver, table: string): Promise<string[]> {
  let byTable = columnCache.get(db);
  if (!byTable) columnCache.set(db, (byTable = new Map()));
  let cols = byTable.get(table);
  if (!cols) {
    const info = await db.select<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`);
    cols = info.map((c) => c.name);
    byTable.set(table, cols);
  }
  return cols;
}

async function markSynced(db: DbDriver, table: string, id: string, updatedAt: string) {
  await db.execute(
    `INSERT INTO sync_rows (table_name, row_id, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (table_name, row_id) DO UPDATE SET updated_at = excluded.updated_at`,
    [table, id, updatedAt],
  );
}

function dirtyRowsSql(t: SyncTable): string {
  return `SELECT t.* FROM ${t.name} t
          LEFT JOIN sync_rows s ON s.table_name = '${t.name}' AND s.row_id = CAST(t.${t.pk} AS TEXT)
          WHERE s.updated_at IS NULL OR s.updated_at <> t.updated_at`;
}

/** Number of local rows not yet uploaded. */
export async function countPendingChanges(db: DbDriver): Promise<number> {
  let total = 0;
  for (const t of SYNC_TABLES) {
    const r = await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM (${dirtyRowsSql(t)})`);
    total += r[0]?.n ?? 0;
  }
  return total;
}

/** Upserts a remote row if it is newer than the local copy. Returns true when local data changed. */
async function applyRemoteRow(db: DbDriver, t: SyncTable, row: RemoteRow): Promise<boolean> {
  const remoteUpdated = String(row.data.updated_at ?? "");
  const local = await db.select<{ updated_at: string }>(`SELECT updated_at FROM ${t.name} WHERE ${t.pk} = $1`, [row.id]);
  const localUpdated = local[0]?.updated_at;

  if (localUpdated != null && localUpdated > remoteUpdated) return false; // local wins; pushed later
  if (localUpdated === remoteUpdated) {
    await markSynced(db, t.name, row.id, remoteUpdated);
    return false;
  }

  // Only write columns this schema version knows about.
  const cols = (await columnsOf(db, t.name)).filter((c) => c in row.data);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const updates = cols.filter((c) => c !== t.pk).map((c) => `${c} = excluded.${c}`).join(", ");
  await db.execute(
    `INSERT INTO ${t.name} (${cols.join(", ")}) VALUES (${placeholders})
     ON CONFLICT (${t.pk}) DO UPDATE SET ${updates}`,
    cols.map((c) => row.data[c] ?? null),
  );
  await markSynced(db, t.name, row.id, remoteUpdated);
  return true;
}

export interface SyncResult {
  pulled: number;
  pushed: number;
  /** Rows that could not be applied this time (retried next sync). */
  deferred: number;
}

export async function syncOnce(db: DbDriver, remote: RemoteStore): Promise<SyncResult> {
  // 1. Fetch children before parents: any child we see was uploaded after its
  //    parent, so the parent is guaranteed to be in the later (parent) fetch.
  const cursors = new Map<string, number>();
  for (const { table_name, last_pulled_ms } of await db.select<{ table_name: string; last_pulled_ms: number }>(
    "SELECT table_name, last_pulled_ms FROM sync_cursors",
  )) {
    cursors.set(table_name, last_pulled_ms);
  }
  const fetched = new Map<string, RemoteRow[]>();
  for (const t of [...SYNC_TABLES].reverse()) fetched.set(t.name, await remote.pull(t.name, cursors.get(t.name) ?? 0));

  // 2. Apply parents before children.
  let pulled = 0;
  let deferred = 0;
  for (const t of SYNC_TABLES) {
    const rows = fetched.get(t.name)!;
    let cursor = cursors.get(t.name) ?? 0;
    let blocked = false;
    for (const row of rows) {
      try {
        if (await applyRemoteRow(db, t, row)) pulled++;
        if (!blocked) cursor = Math.max(cursor, row.syncedAtMs);
      } catch {
        // e.g. a constraint failure; keep the watermark before this row so it is retried.
        deferred++;
        blocked = true;
      }
    }
    await db.execute(
      `INSERT INTO sync_cursors (table_name, last_pulled_ms) VALUES ($1, $2)
       ON CONFLICT (table_name) DO UPDATE SET last_pulled_ms = excluded.last_pulled_ms`,
      [t.name, cursor],
    );
  }

  // 3. Push local changes, parents first.
  let pushed = 0;
  for (const t of SYNC_TABLES) {
    const dirty = await db.select<RowData>(dirtyRowsSql(t));
    for (let i = 0; i < dirty.length; i += PUSH_CHUNK) {
      const chunk = dirty.slice(i, i + PUSH_CHUNK).map((data) => ({ id: String(data[t.pk]), data }));
      await remote.push(t.name, chunk);
      for (const r of chunk) await markSynced(db, t.name, r.id, String(r.data.updated_at));
      pushed += chunk.length;
    }
  }

  return { pulled, pushed, deferred };
}

// ------------------------------------------------------------ ownership

export type PrepareResult = { status: "ready" } | { status: "conflict"; pendingChanges: number };

async function getOwner(db: DbDriver): Promise<string | null> {
  const r = await db.select<{ value: string }>("SELECT value FROM sync_meta WHERE key = 'owner_uid'");
  return r[0]?.value ?? null;
}

async function setOwner(db: DbDriver, uid: string) {
  await db.execute(
    `INSERT INTO sync_meta (key, value) VALUES ('owner_uid', $1)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [uid],
  );
}

/** Deletes every synced row and all sync bookkeeping from the local cache. */
export async function wipeLocalData(db: DbDriver): Promise<void> {
  for (const t of [...SYNC_TABLES].reverse()) await db.execute(`DELETE FROM ${t.name}`);
  await db.execute("DELETE FROM note_drafts");
  await db.execute("DELETE FROM sync_rows");
  await db.execute("DELETE FROM sync_cursors");
  await db.execute("DELETE FROM sync_meta WHERE key = 'owner_uid'");
}

/**
 * Makes the local database belong to `uid`.
 *  - No owner yet (fresh install or pre-account data): adopt it for this account.
 *  - Same owner: nothing to do.
 *  - Different owner: clear the cache, unless it holds unsynced changes
 *    (the caller must then confirm with `discardAndSwitchOwner`).
 */
export async function prepareLocalForUser(db: DbDriver, uid: string): Promise<PrepareResult> {
  const owner = await getOwner(db);
  if (owner === uid) return { status: "ready" };
  if (owner == null) {
    await setOwner(db, uid);
    return { status: "ready" };
  }
  const pending = await countPendingChanges(db);
  if (pending > 0) return { status: "conflict", pendingChanges: pending };
  await wipeLocalData(db);
  await setOwner(db, uid);
  return { status: "ready" };
}

export async function discardAndSwitchOwner(db: DbDriver, uid: string): Promise<void> {
  await wipeLocalData(db);
  await setOwner(db, uid);
}
