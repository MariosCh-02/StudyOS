/**
 * Backups, restore and data import.
 *
 * A snapshot is every row of every synced table (soft-deleted rows included,
 * so deletions survive a restore) as JSON. Restoring makes the database match
 * the snapshot and re-stamps the restored rows, so cloud sync carries the
 * restored state to other devices instead of overwriting it.
 */
import { getDb, type SqlValue } from "@/lib/db";
import { nowIso } from "@/lib/ids";
import { SYNC_TABLES } from "@/sync/engine";

/** Number of database migrations this build knows (src-tauri/migrations). */
export const SCHEMA_VERSION = 9;
export const BACKUP_FORMAT = "studyos-backup";
export const EXPORT_FORMAT = "studyos-export";

export type Row = Record<string, SqlValue>;

export interface Snapshot {
  format: typeof BACKUP_FORMAT | typeof EXPORT_FORMAT;
  version: 1;
  schemaVersion: number;
  createdAt: string;
  /** "all" for a full backup; otherwise what was exported (e.g. "programme"). */
  scope: string;
  title?: string;
  tables: Record<string, Row[]>;
}

const TABLE_NAMES = new Set(SYNC_TABLES.map((t) => t.name));
const PK = new Map(SYNC_TABLES.map((t) => [t.name, t.pk]));

/** Everything in StudyOS, ready to be written as a backup. */
export async function createSnapshot(): Promise<Snapshot> {
  const db = await getDb();
  const tables: Record<string, Row[]> = {};
  for (const t of SYNC_TABLES) tables[t.name] = await db.select<Row>(`SELECT * FROM ${t.name}`);
  return { format: BACKUP_FORMAT, version: 1, schemaVersion: SCHEMA_VERSION, createdAt: nowIso(), scope: "all", tables };
}

export interface SnapshotSummary {
  scope: string;
  title: string | null;
  createdAt: string;
  /** Live (not deleted) rows per table, for the confirmation dialog. */
  counts: { courses: number; notes: number; flashcards: number; tasks: number; projects: number; total: number };
}

/** Parses and checks a backup or export file. Throws a readable error if it can't be used. */
export function parseSnapshot(text: string): Snapshot {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("This file isn't a StudyOS backup (it isn't valid JSON).");
  }
  const s = v as Partial<Snapshot> | null;
  if (!s || typeof s !== "object" || (s.format !== BACKUP_FORMAT && s.format !== EXPORT_FORMAT) || !s.tables || typeof s.tables !== "object") {
    throw new Error("This file isn't a StudyOS backup or export.");
  }
  if (s.version !== 1) throw new Error("This backup was made by a newer version of StudyOS. Update StudyOS first.");
  if (typeof s.schemaVersion !== "number" || s.schemaVersion > SCHEMA_VERSION) throw new Error("This backup was made by a newer version of StudyOS. Update StudyOS first.");
  for (const [name, rows] of Object.entries(s.tables)) {
    if (!TABLE_NAMES.has(name)) continue; // unknown tables are ignored
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== "object" || Array.isArray(r))) throw new Error(`The backup is damaged (table ${name}).`);
    const pk = PK.get(name)!;
    if (rows.some((r) => (r as Row)[pk] == null)) throw new Error(`The backup is damaged (rows without ${pk} in ${name}).`);
  }
  return s as Snapshot;
}

export function summarize(s: Snapshot): SnapshotSummary {
  const live = (t: string) => (s.tables[t] ?? []).filter((r) => r.deleted_at == null).length;
  let total = 0;
  for (const t of TABLE_NAMES) total += live(t);
  return {
    scope: s.scope,
    title: s.title ?? null,
    createdAt: s.createdAt,
    counts: { courses: live("courses"), notes: live("notes"), flashcards: live("flashcards"), tasks: live("tasks"), projects: live("projects"), total },
  };
}

async function columnsOf(table: string): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.select<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => r.name));
}

export interface RestoreResult {
  restored: number;
  /** Rows created after the backup that were removed (soft-deleted, so the removal syncs). */
  removed: number;
  /** Rows that couldn't be written (e.g. pointing at data missing from the backup). */
  failed: number;
}

/**
 * Writes the snapshot's rows into the database (insert or update by primary
 * key), stamping them as changed now. With `replace`, rows that aren't in the
 * snapshot are removed too, so the result matches the backup.
 */
export async function applySnapshot(s: Snapshot, opts: { replace: boolean; onProgress?: (done: number, total: number) => void }): Promise<RestoreResult> {
  const db = await getDb();
  const now = nowIso();
  const result: RestoreResult = { restored: 0, removed: 0, failed: 0 };
  const total = SYNC_TABLES.reduce((n, t) => n + (s.tables[t.name]?.length ?? 0), 0);
  let done = 0;

  const failed: { t: (typeof SYNC_TABLES)[number]; row: Row }[] = [];
  const write = async (t: (typeof SYNC_TABLES)[number], row: Row) => {
    const names = Object.keys(row);
    const updates = names.filter((c) => c !== t.pk).map((c) => `${c} = excluded.${c}`);
    await db.execute(
      `INSERT INTO ${t.name} (${names.join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (${t.pk}) DO ${updates.length ? `UPDATE SET ${updates.join(", ")}` : "NOTHING"}`,
      names.map((c) => row[c] ?? null),
    );
  };

  for (const t of SYNC_TABLES) {
    const rows = s.tables[t.name] ?? [];
    const cols = await columnsOf(t.name);
    const stamp = cols.has("updated_at");
    for (const raw of rows) {
      // Columns from older backups that no longer exist are dropped; missing ones take their defaults.
      const entries = Object.entries(raw).filter(([k, v]) => cols.has(k) && (v === null || typeof v === "string" || typeof v === "number"));
      const row = Object.fromEntries(entries) as Row;
      if (stamp) row.updated_at = now;
      try {
        await write(t, row);
        result.restored++;
      } catch {
        failed.push({ t, row });
      }
      if (++done % 200 === 0) opts.onProgress?.(done, total);
    }
  }
  // A row can fail because a row it points to comes later; retry while that helps.
  for (let pass = 0; pass < 5 && failed.length; pass++) {
    const before = failed.length;
    for (const f of failed.splice(0)) {
      try {
        await write(f.t, f.row);
        result.restored++;
      } catch {
        failed.push(f);
      }
    }
    if (failed.length === before) break;
  }
  result.failed = failed.length;

  if (opts.replace) {
    for (const t of SYNC_TABLES) {
      const cols = await columnsOf(t.name);
      if (!cols.has("deleted_at")) continue; // e.g. settings: kept as they are
      const keep = new Set((s.tables[t.name] ?? []).map((r) => String(r[t.pk])));
      const live = await db.select<{ pk: string }>(`SELECT CAST(${t.pk} AS TEXT) AS pk FROM ${t.name} WHERE deleted_at IS NULL`);
      for (const { pk } of live) {
        if (keep.has(pk)) continue;
        await db.execute(`UPDATE ${t.name} SET deleted_at = $2, updated_at = $2 WHERE ${t.pk} = $1 AND deleted_at IS NULL`, [pk, now]);
        result.removed++;
      }
    }
    // Unsaved editor drafts belong to the replaced notes.
    await db.execute("DELETE FROM note_drafts");
  }
  opts.onProgress?.(total, total);
  return result;
}

// --------------------------------------------------------------- partial export

/** A programme with everything that belongs to it, as an importable export. */
export async function exportProgramme(programmeId: string): Promise<Snapshot> {
  const db = await getDb();
  const one = async (sql: string, params: SqlValue[]) => db.select<Row>(sql, params);
  const programmes = await one("SELECT * FROM programmes WHERE id = $1", [programmeId]);
  const p = programmes[0];
  if (!p) throw new Error("Programme not found.");
  const ids = (rows: Row[]) => rows.map((r) => String(r.id));
  const inList = (list: string[]) => (list.length ? list.map((x) => `'${x.replace(/'/g, "''")}'`).join(", ") : "''");

  const institutions = await one("SELECT * FROM institutions WHERE id = $1", [p.institution_id ?? ""]);
  const years = await one("SELECT * FROM academic_years WHERE programme_id = $1", [programmeId]);
  const semesters = await one(`SELECT * FROM semesters WHERE academic_year_id IN (${inList(ids(years))})`, []);
  const courses = await one("SELECT * FROM courses WHERE programme_id = $1", [programmeId]);
  const c = inList(ids(courses));
  const lectures = await one(`SELECT * FROM lectures WHERE course_id IN (${c})`, []);
  const notes = await one(`SELECT * FROM notes WHERE course_id IN (${c}) OR lecture_id IN (${inList(ids(lectures))})`, []);
  const assignments = await one(`SELECT * FROM assignments WHERE course_id IN (${c})`, []);
  const exams = await one(`SELECT * FROM exams WHERE course_id IN (${c})`, []);
  const owners = [...ids(courses), ...ids(lectures), ...ids(notes), ...ids(assignments), ...ids(exams)];
  const series = await one(`SELECT * FROM recurring_events WHERE course_id IN (${c})`, []);
  const tables: Record<string, Row[]> = {
    institutions,
    programmes,
    academic_years: years,
    semesters,
    courses,
    lectures,
    notes,
    attachments: await one(`SELECT * FROM attachments WHERE owner_id IN (${inList(owners)})`, []),
    recurring_events: series,
    recurrence_exceptions: await one(`SELECT * FROM recurrence_exceptions WHERE series_id IN (${inList(ids(series))})`, []),
    calendar_events: await one(`SELECT * FROM calendar_events WHERE course_id IN (${c})`, []),
    assignments,
    exams,
    tasks: await one(`SELECT * FROM tasks WHERE course_id IN (${c})`, []),
    attendance: await one(`SELECT * FROM attendance WHERE course_id IN (${c})`, []),
    study_sessions: await one(`SELECT * FROM study_sessions WHERE course_id IN (${c})`, []),
    flashcards: await one(`SELECT * FROM flashcards WHERE course_id IN (${c})`, []),
    questions: await one(`SELECT * FROM questions WHERE course_id IN (${c})`, []),
  };
  // Topics referenced by the exported cards and questions, so they import cleanly.
  const topicIds = [...new Set([...tables.flashcards!, ...tables.questions!].map((r) => r.topic_id).filter((x): x is string => typeof x === "string"))];
  tables.topics = await one(`SELECT * FROM topics WHERE id IN (${inList(topicIds)})`, []);
  // References to things outside the programme (projects, papers, lessons, other tasks…) are
  // cleared, so those rows import into another installation instead of being rejected.
  const keep = (table: string) => new Set(ids(tables[table] ?? []));
  const clear = (table: string, column: string, allowed?: Set<string>) => {
    for (const r of tables[table] ?? []) if (r[column] != null && !allowed?.has(String(r[column]))) r[column] = null;
  };
  clear("notes", "project_id");
  clear("notes", "paper_id");
  clear("notes", "section");
  clear("tasks", "project_id");
  clear("study_sessions", "task_id", keep("tasks"));
  clear("study_sessions", "lecture_id", keep("lectures"));
  clear("attendance", "lecture_id", keep("lectures"));
  for (const t of ["flashcards", "questions"]) {
    clear(t, "lesson_id");
    clear(t, "subject_id");
  }
  clear("flashcards", "note_id", keep("notes"));
  return { format: EXPORT_FORMAT, version: 1, schemaVersion: SCHEMA_VERSION, createdAt: nowIso(), scope: "programme", title: String(p.name ?? "Programme"), tables };
}

// --------------------------------------------------------------- auto backups

/** Local "YYYYMMDD-HHMMSS" used in backup file names. */
export function backupStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Parses a backup stamp back to a Date (local time). */
export function stampToDate(stamp: string): Date {
  return new Date(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(9, 11), +stamp.slice(11, 13), +stamp.slice(13, 15));
}

/** True when the newest automatic backup is older than `hours` (or there is none). */
export function autoBackupDue(backups: { kind: string; stamp: string }[], now: Date, hours = 24): boolean {
  const last = backups.filter((b) => b.kind === "auto").sort((a, b) => b.stamp.localeCompare(a.stamp))[0];
  return !last || now.getTime() - stampToDate(last.stamp).getTime() >= hours * 3_600_000;
}
