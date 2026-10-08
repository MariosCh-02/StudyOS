import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import type { Lecture, Note, NoteSummary } from "@/domain/types";
import { docToText, lectureTemplateDoc, parseDoc, type DocNode } from "@/domain/noteContent";
import { syncInlineTags } from "./tags";

interface SummaryRow {
  id: string;
  course_id: string | null;
  lecture_id: string | null;
  project_id: string | null;
  paper_id: string | null;
  title: string;
  snippet: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

interface Row extends SummaryRow {
  content: string;
  content_text: string;
}

const mapSummary = (r: SummaryRow): NoteSummary => ({
  id: r.id,
  courseId: r.course_id,
  lectureId: r.lecture_id,
  projectId: r.project_id,
  paperId: r.paper_id,
  title: r.title,
  snippet: r.snippet,
  pinned: r.pinned === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const SUMMARY_COLUMNS = "id, course_id, lecture_id, project_id, paper_id, title, substr(content_text, 1, 240) AS snippet, pinned, created_at, updated_at";
const MAX_TITLE = 200;

export interface NoteFilter {
  courseId?: string;
  lectureId?: string;
  projectId?: string;
  paperId?: string;
  /** Case-insensitive match on title or text. */
  search?: string;
  limit?: number;
}

export async function listNotes(filter: NoteFilter = {}): Promise<NoteSummary[]> {
  const db = await getDb();
  const clauses = ["deleted_at IS NULL"];
  const params: (string | number)[] = [];
  const add = (sql: string, v: string | number) => {
    params.push(v);
    clauses.push(sql.replace("?", `$${params.length}`));
  };
  if (filter.courseId) add("course_id = ?", filter.courseId);
  if (filter.lectureId) add("lecture_id = ?", filter.lectureId);
  if (filter.projectId) add("project_id = ?", filter.projectId);
  if (filter.paperId) add("paper_id = ?", filter.paperId);
  if (filter.search?.trim()) {
    const term = `%${filter.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(term);
    clauses.push(`(title LIKE $${params.length} ESCAPE '\\' OR content_text LIKE $${params.length} ESCAPE '\\')`);
  }
  params.push(Math.min(Math.max(filter.limit ?? 200, 1), 50_000));
  const rows = await db.select<SummaryRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM notes WHERE ${clauses.join(" AND ")}
     ORDER BY pinned DESC, updated_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(mapSummary);
}

export async function getNote(id: string): Promise<Note | null> {
  const db = await getDb();
  const rows = await db.select<Row>(`SELECT ${SUMMARY_COLUMNS}, content, content_text FROM notes WHERE id = $1 AND deleted_at IS NULL`, [id]);
  const r = rows[0];
  return r ? { ...mapSummary(r), content: r.content, contentText: r.content_text } : null;
}

export interface NewNote {
  courseId?: string | null;
  lectureId?: string | null;
  projectId?: string | null;
  paperId?: string | null;
  /** Research workspace section (see services/projects). */
  section?: string | null;
  title?: string;
  doc?: DocNode;
}

export async function createNote(input: NewNote = {}): Promise<Note> {
  const db = await getDb();
  let courseId = input.courseId ?? null;
  if (input.lectureId) {
    const l = await db.select<{ course_id: string }>("SELECT course_id FROM lectures WHERE id = $1 AND deleted_at IS NULL", [input.lectureId]);
    if (!l[0]) throw new Error("Lecture not found.");
    courseId = l[0].course_id; // a lecture note always belongs to the lecture's course
  }
  const doc = input.doc ?? { type: "doc", content: [] };
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO notes (id, course_id, lecture_id, project_id, paper_id, section, title, content, content_text, pinned, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $10)`,
    [id, courseId, input.lectureId ?? null, input.projectId ?? null, input.paperId ?? null, input.section ?? null, (input.title ?? "").trim().slice(0, MAX_TITLE), JSON.stringify(doc), docToText(doc), now],
  );
  return (await getNote(id))!;
}

/** Persists editor state. Returns the new updated_at. */
export async function saveNote(id: string, title: string, contentJson: string): Promise<string> {
  const doc = parseDoc(contentJson);
  const db = await getDb();
  const now = nowIso();
  const res = await db.execute(
    "UPDATE notes SET title = $2, content = $3, content_text = $4, updated_at = $5 WHERE id = $1 AND deleted_at IS NULL",
    [id, title.trim().slice(0, MAX_TITLE), JSON.stringify(doc), docToText(doc), now],
  );
  if (res.rowsAffected === 0) throw new Error("This note no longer exists.");
  await syncInlineTags(id, docToText(doc));
  return now;
}

export async function setNotePinned(id: string, pinned: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE notes SET pinned = $2, updated_at = $3 WHERE id = $1 AND deleted_at IS NULL", [id, pinned ? 1 : 0, nowIso()]);
}

/** Re-files a note under another course (or none). Lecture notes keep their lecture's course. */
export async function moveNote(id: string, courseId: string | null): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE notes SET course_id = $2, updated_at = $3 WHERE id = $1 AND lecture_id IS NULL AND deleted_at IS NULL",
    [id, courseId, nowIso()],
  );
}

export async function deleteNote(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute(
    "UPDATE attachments SET deleted_at = $2, updated_at = $2 WHERE owner_type = 'note' AND owner_id = $1 AND deleted_at IS NULL",
    [id, now],
  );
  await db.execute("UPDATE notes SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("DELETE FROM note_drafts WHERE note_id = $1", [id]);
}

/** The lecture's main note (oldest), created from the lecture template if missing. */
export async function getOrCreateLectureNote(lecture: Lecture, template?: DocNode): Promise<Note> {
  const db = await getDb();
  const existing = await db.select<{ id: string }>(
    "SELECT id FROM notes WHERE lecture_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
    [lecture.id],
  );
  if (existing[0]) return (await getNote(existing[0].id))!;
  const title = lecture.number != null ? `Lecture ${lecture.number} — ${lecture.title}` : lecture.title;
  return createNote({ lectureId: lecture.id, title, doc: template ?? lectureTemplateDoc(lecture.number, lecture.title) });
}

// ----------------------------------------------------------- crash recovery

export interface NoteDraft {
  noteId: string;
  title: string;
  content: string;
  savedAt: string;
}

/** Records the latest unsaved editor state (local only, never synced). */
export async function saveDraft(noteId: string, title: string, content: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO note_drafts (note_id, title, content, saved_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (note_id) DO UPDATE SET title = excluded.title, content = excluded.content, saved_at = excluded.saved_at`,
    [noteId, title, content, nowIso()],
  );
}

/** Removes the draft once its content has been saved. */
export async function clearDraft(noteId: string, savedContent: string): Promise<void> {
  const db = await getDb();
  // Only clear if the draft matches what was saved; a newer draft must survive.
  await db.execute("DELETE FROM note_drafts WHERE note_id = $1 AND content = $2", [noteId, savedContent]);
}

export async function discardDraft(noteId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM note_drafts WHERE note_id = $1", [noteId]);
}

/** A draft that differs from the saved note, i.e. unsaved work from a crash. */
export async function getRecoverableDraft(note: Note): Promise<NoteDraft | null> {
  const db = await getDb();
  const rows = await db.select<{ note_id: string; title: string; content: string; saved_at: string }>(
    "SELECT * FROM note_drafts WHERE note_id = $1",
    [note.id],
  );
  const d = rows[0];
  if (!d) return null;
  if (d.content === note.content && d.title === note.title) {
    await discardDraft(note.id);
    return null;
  }
  return { noteId: d.note_id, title: d.title, content: d.content, savedAt: d.saved_at };
}
