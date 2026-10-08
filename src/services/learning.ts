/** Learning tracks, subjects, lessons, topics, formulas and diagnostics. */
import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import { assertValid, blankToNull, requireText } from "@/domain/validation";

export const LEVEL_LABELS: Record<number, string> = { 1: "Foundation", 2: "University", 3: "Advanced", 4: "Challenge" };

const parseJsonArray = <T,>(json: string | null): T[] => {
  try {
    const v = JSON.parse(json ?? "[]") as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
};

async function softDelete(table: string, id: string) {
  const db = await getDb();
  const now = nowIso();
  await db.execute(`UPDATE ${table} SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL`, [id, now]);
}

// ------------------------------------------------------------------ topics

export interface Topic {
  id: string;
  name: string;
  subject: string | null;
  description: string | null;
}

export async function listTopics(): Promise<Topic[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; name: string; subject: string | null; description: string | null }>(
    "SELECT id, name, subject, description FROM topics WHERE deleted_at IS NULL ORDER BY subject COLLATE NOCASE, name COLLATE NOCASE",
  );
  return rows;
}

/** Finds a topic by name (case-insensitive) or creates it. */
export async function ensureTopic(name: string, subject: string | null = null): Promise<Topic> {
  const err = requireText(name, "Topic", 120);
  if (err) throw new Error(err);
  const db = await getDb();
  const existing = await db.select<Topic>("SELECT id, name, subject, description FROM topics WHERE deleted_at IS NULL AND name = $1 COLLATE NOCASE LIMIT 1", [name.trim()]);
  if (existing[0]) return existing[0];
  const id = newId();
  const now = nowIso();
  await db.execute("INSERT INTO topics (id, name, subject, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)", [id, name.trim(), blankToNull(subject), now]);
  return { id, name: name.trim(), subject: blankToNull(subject), description: null };
}

export async function updateTopic(id: string, input: { name: string; subject: string | null; description: string | null }): Promise<void> {
  assertValid({ name: requireText(input.name, "Topic", 120) });
  const db = await getDb();
  await db.execute("UPDATE topics SET name = $2, subject = $3, description = $4, updated_at = $5 WHERE id = $1 AND deleted_at IS NULL", [
    id,
    input.name.trim(),
    blankToNull(input.subject),
    blankToNull(input.description),
    nowIso(),
  ]);
}

export const deleteTopic = (id: string) => softDelete("topics", id);

// ------------------------------------------------------------------ tracks

export interface Track {
  id: string;
  title: string;
  description: string | null;
  color: string | null;
  packId: string | null;
  packVersion: number | null;
  subjectCount: number;
  lessonCount: number;
  completedCount: number;
}

export async function listTracks(): Promise<Track[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; title: string; description: string | null; color: string | null; pack_id: string | null; pack_version: number | null; subjects: number; lessons: number; completed: number }>(
    `SELECT t.id, t.title, t.description, t.color, t.pack_id, t.pack_version,
       (SELECT COUNT(*) FROM subjects s WHERE s.track_id = t.id AND s.deleted_at IS NULL) AS subjects,
       (SELECT COUNT(*) FROM lessons l JOIN subjects s ON s.id = l.subject_id WHERE s.track_id = t.id AND l.deleted_at IS NULL AND s.deleted_at IS NULL) AS lessons,
       (SELECT COUNT(*) FROM lessons l JOIN subjects s ON s.id = l.subject_id WHERE s.track_id = t.id AND l.deleted_at IS NULL AND s.deleted_at IS NULL AND l.completed_at IS NOT NULL) AS completed
     FROM learning_tracks t WHERE t.deleted_at IS NULL ORDER BY t.title COLLATE NOCASE`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    color: r.color,
    packId: r.pack_id,
    packVersion: r.pack_version,
    subjectCount: r.subjects,
    lessonCount: r.lessons,
    completedCount: r.completed,
  }));
}

export async function getTrack(id: string): Promise<Track | null> {
  return (await listTracks()).find((t) => t.id === id) ?? null;
}

export async function createTrack(input: { title: string; description: string | null; color: string | null }): Promise<string> {
  assertValid({ title: requireText(input.title, "Title") });
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute("INSERT INTO learning_tracks (id, title, description, color, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)", [
    id,
    input.title.trim(),
    blankToNull(input.description),
    input.color,
    now,
  ]);
  return id;
}

export async function updateTrack(id: string, input: { title: string; description: string | null; color: string | null }): Promise<void> {
  assertValid({ title: requireText(input.title, "Title") });
  const db = await getDb();
  await db.execute("UPDATE learning_tracks SET title = $2, description = $3, color = $4, updated_at = $5 WHERE id = $1 AND deleted_at IS NULL", [
    id,
    input.title.trim(),
    blankToNull(input.description),
    input.color,
    nowIso(),
  ]);
}

/** Removes a track with its subjects and lessons. Questions and flashcards stay in the bank. */
export async function deleteTrack(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute(
    "UPDATE lessons SET deleted_at = $2, updated_at = $2 WHERE deleted_at IS NULL AND subject_id IN (SELECT id FROM subjects WHERE track_id = $1)",
    [id, now],
  );
  await db.execute("UPDATE subjects SET deleted_at = $2, updated_at = $2 WHERE track_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE learning_tracks SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

// ---------------------------------------------------------------- subjects

export interface Subject {
  id: string;
  trackId: string;
  name: string;
  description: string | null;
  sortOrder: number;
}

export async function listSubjects(trackId?: string): Promise<Subject[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; track_id: string; name: string; description: string | null; sort_order: number }>(
    `SELECT s.id, s.track_id, s.name, s.description, s.sort_order FROM subjects s JOIN learning_tracks t ON t.id = s.track_id
     WHERE s.deleted_at IS NULL AND t.deleted_at IS NULL ${trackId ? "AND s.track_id = $1" : ""} ORDER BY s.sort_order, s.name`,
    trackId ? [trackId] : [],
  );
  return rows.map((r) => ({ id: r.id, trackId: r.track_id, name: r.name, description: r.description, sortOrder: r.sort_order }));
}

export async function createSubject(trackId: string, name: string, description: string | null = null): Promise<string> {
  assertValid({ name: requireText(name, "Subject") });
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO subjects (id, track_id, name, description, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM subjects WHERE track_id = $2), $5, $5)`,
    [id, trackId, name.trim(), blankToNull(description), now],
  );
  return id;
}

export async function updateSubject(id: string, name: string, description: string | null): Promise<void> {
  assertValid({ name: requireText(name, "Subject") });
  const db = await getDb();
  await db.execute("UPDATE subjects SET name = $2, description = $3, updated_at = $4 WHERE id = $1 AND deleted_at IS NULL", [id, name.trim(), blankToNull(description), nowIso()]);
}

export async function deleteSubject(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE lessons SET deleted_at = $2, updated_at = $2 WHERE subject_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE subjects SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

// ----------------------------------------------------------------- lessons

export interface Lesson {
  id: string;
  subjectId: string;
  level: number;
  sortOrder: number;
  title: string;
  summary: string | null;
  content: string;
  topicId: string | null;
  topicName: string | null;
  estimatedMinutes: number | null;
  completedAt: string | null;
  subjectName: string;
  trackId: string;
  trackTitle: string;
}

export type LessonInput = Pick<Lesson, "subjectId" | "level" | "title" | "summary" | "content" | "estimatedMinutes"> & { topicName: string | null };

const LESSON_SELECT = `SELECT l.*, s.name AS subject_name, s.track_id, t.title AS track_title, tp.name AS topic_name
  FROM lessons l JOIN subjects s ON s.id = l.subject_id JOIN learning_tracks t ON t.id = s.track_id
  LEFT JOIN topics tp ON tp.id = l.topic_id AND tp.deleted_at IS NULL
  WHERE l.deleted_at IS NULL AND s.deleted_at IS NULL AND t.deleted_at IS NULL`;

interface LessonRow {
  id: string;
  subject_id: string;
  level: number;
  sort_order: number;
  title: string;
  summary: string | null;
  content: string;
  topic_id: string | null;
  topic_name: string | null;
  estimated_minutes: number | null;
  completed_at: string | null;
  subject_name: string;
  track_id: string;
  track_title: string;
}

const mapLesson = (r: LessonRow): Lesson => ({
  id: r.id,
  subjectId: r.subject_id,
  level: r.level,
  sortOrder: r.sort_order,
  title: r.title,
  summary: r.summary,
  content: r.content,
  topicId: r.topic_id,
  topicName: r.topic_name,
  estimatedMinutes: r.estimated_minutes,
  completedAt: r.completed_at,
  subjectName: r.subject_name,
  trackId: r.track_id,
  trackTitle: r.track_title,
});

export async function listLessons(filter: { trackId?: string; subjectId?: string } = {}): Promise<Lesson[]> {
  const db = await getDb();
  const params: string[] = [];
  let sql = LESSON_SELECT;
  if (filter.trackId) {
    params.push(filter.trackId);
    sql += ` AND s.track_id = $${params.length}`;
  }
  if (filter.subjectId) {
    params.push(filter.subjectId);
    sql += ` AND l.subject_id = $${params.length}`;
  }
  const rows = await db.select<LessonRow>(`${sql} ORDER BY s.sort_order, l.level, l.sort_order, l.title`, params);
  return rows.map(mapLesson);
}

export async function getLesson(id: string): Promise<Lesson | null> {
  const db = await getDb();
  const rows = await db.select<LessonRow>(`${LESSON_SELECT} AND l.id = $1`, [id]);
  return rows[0] ? mapLesson(rows[0]) : null;
}

function validateLesson(input: LessonInput) {
  assertValid({
    title: requireText(input.title, "Title"),
    subjectId: input.subjectId ? undefined : "Choose a subject.",
    level: [1, 2, 3, 4].includes(input.level) ? undefined : "Choose a level.",
    estimatedMinutes: input.estimatedMinutes != null && !(input.estimatedMinutes > 0) ? "Minutes must be positive." : undefined,
  });
}

export async function createLesson(input: LessonInput): Promise<string> {
  validateLesson(input);
  const topic = input.topicName?.trim() ? await ensureTopic(input.topicName) : null;
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO lessons (id, subject_id, level, sort_order, title, summary, content, topic_id, estimated_minutes, created_at, updated_at)
     VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM lessons WHERE subject_id = $2 AND level = $3), $4, $5, $6, $7, $8, $9, $9)`,
    [id, input.subjectId, input.level, input.title.trim(), blankToNull(input.summary), input.content, topic?.id ?? null, input.estimatedMinutes, now],
  );
  return id;
}

export async function updateLesson(id: string, input: LessonInput): Promise<void> {
  validateLesson(input);
  const topic = input.topicName?.trim() ? await ensureTopic(input.topicName) : null;
  const db = await getDb();
  await db.execute(
    `UPDATE lessons SET subject_id = $2, level = $3, title = $4, summary = $5, content = $6, topic_id = $7, estimated_minutes = $8, updated_at = $9
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, input.subjectId, input.level, input.title.trim(), blankToNull(input.summary), input.content, topic?.id ?? null, input.estimatedMinutes, nowIso()],
  );
}

export async function setLessonCompleted(id: string, completed: boolean): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE lessons SET completed_at = $2, updated_at = $3 WHERE id = $1 AND deleted_at IS NULL", [id, completed ? now : null, now]);
}

export const deleteLesson = (id: string) => softDelete("lessons", id);

// ---------------------------------------------------------------- formulas

export interface FormulaVariable {
  symbol: string;
  meaning: string;
}

export interface Formula {
  id: string;
  title: string;
  latex: string;
  explanation: string | null;
  variables: FormulaVariable[];
  example: string | null;
  subject: string | null;
  topicId: string | null;
  topicName: string | null;
  courseIds: string[];
  noteIds: string[];
  tags: string[];
}

export type FormulaInput = Omit<Formula, "id" | "topicId" | "topicName">;

interface FormulaRow {
  id: string;
  title: string;
  latex: string;
  explanation: string | null;
  variables: string;
  example: string | null;
  subject: string | null;
  topic_id: string | null;
  topic_name: string | null;
  course_ids: string;
  note_ids: string;
  tags: string;
}

const mapFormula = (r: FormulaRow): Formula => ({
  id: r.id,
  title: r.title,
  latex: r.latex,
  explanation: r.explanation,
  variables: parseJsonArray<FormulaVariable>(r.variables),
  example: r.example,
  subject: r.subject,
  topicId: r.topic_id,
  topicName: r.topic_name,
  courseIds: parseJsonArray<string>(r.course_ids),
  noteIds: parseJsonArray<string>(r.note_ids),
  tags: parseJsonArray<string>(r.tags),
});

export async function listFormulas(filter: { subject?: string; courseId?: string; search?: string } = {}): Promise<Formula[]> {
  const db = await getDb();
  const rows = await db.select<FormulaRow>(
    `SELECT f.*, tp.name AS topic_name FROM formulas f LEFT JOIN topics tp ON tp.id = f.topic_id AND tp.deleted_at IS NULL
     WHERE f.deleted_at IS NULL ORDER BY f.subject COLLATE NOCASE, f.title COLLATE NOCASE`,
  );
  const term = filter.search?.trim().toLowerCase();
  return rows
    .map(mapFormula)
    .filter((f) => (!filter.subject || f.subject === filter.subject) && (!filter.courseId || f.courseIds.includes(filter.courseId)))
    .filter((f) => !term || [f.title, f.latex, f.explanation ?? "", f.subject ?? "", f.topicName ?? "", ...f.tags].some((s) => s.toLowerCase().includes(term)));
}

function validateFormula(input: FormulaInput) {
  assertValid({ title: requireText(input.title, "Name"), latex: requireText(input.latex, "Formula", 4000) });
}

export async function createFormula(input: FormulaInput, topicName: string | null = null): Promise<string> {
  validateFormula(input);
  const topic = topicName?.trim() ? await ensureTopic(topicName, input.subject) : null;
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO formulas (id, title, latex, explanation, variables, example, subject, topic_id, course_ids, note_ids, tags, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
    [id, input.title.trim(), input.latex.trim(), blankToNull(input.explanation), JSON.stringify(input.variables.filter((v) => v.symbol.trim())), blankToNull(input.example),
      blankToNull(input.subject), topic?.id ?? null, JSON.stringify(input.courseIds), JSON.stringify(input.noteIds), JSON.stringify(input.tags), now],
  );
  return id;
}

export async function updateFormula(id: string, input: FormulaInput, topicName: string | null = null): Promise<void> {
  validateFormula(input);
  const topic = topicName?.trim() ? await ensureTopic(topicName, input.subject) : null;
  const db = await getDb();
  await db.execute(
    `UPDATE formulas SET title = $2, latex = $3, explanation = $4, variables = $5, example = $6, subject = $7, topic_id = $8, course_ids = $9,
       note_ids = $10, tags = $11, updated_at = $12 WHERE id = $1 AND deleted_at IS NULL`,
    [id, input.title.trim(), input.latex.trim(), blankToNull(input.explanation), JSON.stringify(input.variables.filter((v) => v.symbol.trim())), blankToNull(input.example),
      blankToNull(input.subject), topic?.id ?? null, JSON.stringify(input.courseIds), JSON.stringify(input.noteIds), JSON.stringify(input.tags), nowIso()],
  );
}

export const deleteFormula = (id: string) => softDelete("formulas", id);

// ------------------------------------------------------------- diagnostics

export interface Diagnostic {
  id: string;
  title: string;
  description: string | null;
  trackId: string | null;
  questionIds: string[];
}

export async function listDiagnostics(): Promise<Diagnostic[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; title: string; description: string | null; track_id: string | null; question_ids: string }>(
    "SELECT * FROM diagnostics WHERE deleted_at IS NULL ORDER BY title COLLATE NOCASE",
  );
  return rows.map((r) => ({ id: r.id, title: r.title, description: r.description, trackId: r.track_id, questionIds: parseJsonArray<string>(r.question_ids) }));
}

export async function getDiagnostic(id: string): Promise<Diagnostic | null> {
  return (await listDiagnostics()).find((d) => d.id === id) ?? null;
}

export async function saveDiagnostic(input: Omit<Diagnostic, "id">, id?: string): Promise<string> {
  assertValid({ title: requireText(input.title, "Title"), questionIds: input.questionIds.length ? undefined : "Choose at least one question." });
  const db = await getDb();
  const now = nowIso();
  if (id) {
    await db.execute("UPDATE diagnostics SET title = $2, description = $3, track_id = $4, question_ids = $5, updated_at = $6 WHERE id = $1", [
      id,
      input.title.trim(),
      blankToNull(input.description),
      input.trackId,
      JSON.stringify(input.questionIds),
      now,
    ]);
    return id;
  }
  const newIdValue = newId();
  await db.execute("INSERT INTO diagnostics (id, title, description, track_id, question_ids, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)", [
    newIdValue,
    input.title.trim(),
    blankToNull(input.description),
    input.trackId,
    JSON.stringify(input.questionIds),
    now,
  ]);
  return newIdValue;
}

export const deleteDiagnostic = (id: string) => softDelete("diagnostics", id);
