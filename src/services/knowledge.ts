/**
 * Knowledge base: concepts that connect material across courses
 * (definition, formula, intuition, examples) with links to related items.
 */
import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import { assertValid, blankToNull, requireText } from "@/domain/validation";
import { ensureTopic } from "./learning";
import { createFlashcard } from "./practice";

export type LinkTarget = "course" | "lecture" | "note" | "flashcard" | "question" | "formula" | "lesson" | "paper" | "project";

export interface KnowledgeEntry {
  id: string;
  title: string;
  aliases: string[];
  definition: string;
  formula: string | null;
  intuition: string | null;
  examples: string | null;
  topicId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeInput = Pick<KnowledgeEntry, "title" | "aliases" | "definition" | "formula" | "intuition" | "examples">;

interface Row {
  id: string;
  title: string;
  aliases: string;
  definition: string;
  formula: string | null;
  intuition: string | null;
  examples: string | null;
  topic_id: string | null;
  created_at: string;
  updated_at: string;
}

const map = (r: Row): KnowledgeEntry => ({
  id: r.id,
  title: r.title,
  aliases: r.aliases ? r.aliases.split(",").map((a) => a.trim()).filter(Boolean) : [],
  definition: r.definition,
  formula: r.formula,
  intuition: r.intuition,
  examples: r.examples,
  topicId: r.topic_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface EntrySummary extends KnowledgeEntry {
  linkCount: number;
  courseIds: string[];
}

export async function listEntries(filter: { courseId?: string; search?: string } = {}): Promise<EntrySummary[]> {
  const db = await getDb();
  const rows = await db.select<Row & { link_count: number; course_ids: string | null }>(
    `SELECT e.*, (SELECT COUNT(*) FROM knowledge_links l WHERE l.entry_id = e.id AND l.deleted_at IS NULL) AS link_count,
       (SELECT GROUP_CONCAT(l.target_id) FROM knowledge_links l WHERE l.entry_id = e.id AND l.target_type = 'course' AND l.deleted_at IS NULL) AS course_ids
     FROM knowledge_entries e WHERE e.deleted_at IS NULL ORDER BY e.title COLLATE NOCASE`,
  );
  const term = filter.search?.trim().toLowerCase();
  return rows
    .map((r) => ({ ...map(r), linkCount: r.link_count, courseIds: r.course_ids ? r.course_ids.split(",") : [] }))
    .filter((e) => !filter.courseId || e.courseIds.includes(filter.courseId))
    .filter((e) => !term || [e.title, ...e.aliases, e.definition].some((s) => s.toLowerCase().includes(term)));
}

export async function getEntry(id: string): Promise<KnowledgeEntry | null> {
  const db = await getDb();
  const rows = await db.select<Row>("SELECT * FROM knowledge_entries WHERE id = $1 AND deleted_at IS NULL", [id]);
  return rows[0] ? map(rows[0]) : null;
}

/** An existing concept with this title or alias (case-insensitive). */
export async function findEntryByName(name: string): Promise<KnowledgeEntry | null> {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return (await listEntries()).find((e) => e.title.toLowerCase() === n || e.aliases.some((a) => a.toLowerCase() === n)) ?? null;
}

function validate(input: KnowledgeInput) {
  assertValid({ title: requireText(input.title, "Concept", 150) });
}

export async function createEntry(input: KnowledgeInput): Promise<KnowledgeEntry> {
  validate(input);
  // The concept is also a mastery topic, so practice on it shows up here.
  const topic = await ensureTopic(input.title);
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO knowledge_entries (id, title, aliases, definition, formula, intuition, examples, topic_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
    [id, input.title.trim(), input.aliases.join(", "), input.definition.trim(), blankToNull(input.formula), blankToNull(input.intuition), blankToNull(input.examples), topic.id, now],
  );
  return (await getEntry(id))!;
}

export async function updateEntry(id: string, input: KnowledgeInput): Promise<KnowledgeEntry> {
  validate(input);
  const topic = await ensureTopic(input.title);
  const db = await getDb();
  await db.execute(
    `UPDATE knowledge_entries SET title = $2, aliases = $3, definition = $4, formula = $5, intuition = $6, examples = $7, topic_id = $8, updated_at = $9
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, input.title.trim(), input.aliases.join(", "), input.definition.trim(), blankToNull(input.formula), blankToNull(input.intuition), blankToNull(input.examples), topic.id, nowIso()],
  );
  const e = await getEntry(id);
  if (!e) throw new Error("Concept not found.");
  return e;
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE knowledge_links SET deleted_at = $2, updated_at = $2 WHERE entry_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE knowledge_entries SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

// ------------------------------------------------------------------- links

export async function linkEntry(entryId: string, type: LinkTarget, targetId: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute(
    `INSERT INTO knowledge_links (id, entry_id, target_type, target_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at`,
    [`${entryId}|${type}|${targetId}`, entryId, type, targetId, now],
  );
}

export async function unlinkEntry(entryId: string, type: LinkTarget, targetId: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE knowledge_links SET deleted_at = $2, updated_at = $2 WHERE id = $1", [`${entryId}|${type}|${targetId}`, now]);
}

export interface LinkedItem {
  type: LinkTarget;
  id: string;
  title: string;
  /** Extra context, e.g. course code or lecture date. */
  detail: string | null;
}

/** Everything linked to a concept, with titles; links to deleted items are skipped. */
export async function linkedItems(entryId: string): Promise<LinkedItem[]> {
  const db = await getDb();
  return db.select<LinkedItem>(
    `SELECT l.target_type AS type, l.target_id AS id,
       COALESCE(c.name, lec.title, n.title, f.front, q.prompt, fo.title, le.title, pa.title, pr.title) AS title,
       COALESCE(c.code, lec.date, lc.name, CAST(pa.year AS TEXT), NULL) AS detail
     FROM knowledge_links l
     LEFT JOIN courses c ON l.target_type = 'course' AND c.id = l.target_id AND c.deleted_at IS NULL
     LEFT JOIN lectures lec ON l.target_type = 'lecture' AND lec.id = l.target_id AND lec.deleted_at IS NULL
     LEFT JOIN courses lc ON lc.id = lec.course_id
     LEFT JOIN notes n ON l.target_type = 'note' AND n.id = l.target_id AND n.deleted_at IS NULL
     LEFT JOIN flashcards f ON l.target_type = 'flashcard' AND f.id = l.target_id AND f.deleted_at IS NULL
     LEFT JOIN questions q ON l.target_type = 'question' AND q.id = l.target_id AND q.deleted_at IS NULL
     LEFT JOIN formulas fo ON l.target_type = 'formula' AND fo.id = l.target_id AND fo.deleted_at IS NULL
     LEFT JOIN lessons le ON l.target_type = 'lesson' AND le.id = l.target_id AND le.deleted_at IS NULL
     LEFT JOIN papers pa ON l.target_type = 'paper' AND pa.id = l.target_id AND pa.deleted_at IS NULL
     LEFT JOIN projects pr ON l.target_type = 'project' AND pr.id = l.target_id AND pr.deleted_at IS NULL
     WHERE l.entry_id = $1 AND l.deleted_at IS NULL
       AND COALESCE(c.id, lec.id, n.id, f.id, q.id, fo.id, le.id, pa.id, pr.id) IS NOT NULL
     ORDER BY l.target_type, title`,
    [entryId],
  );
}

/** Concepts linked to an item (shown on notes, lectures and courses). */
export async function entriesFor(type: LinkTarget, targetId: string): Promise<KnowledgeEntry[]> {
  const db = await getDb();
  const rows = await db.select<Row>(
    `SELECT e.* FROM knowledge_entries e JOIN knowledge_links l ON l.entry_id = e.id
     WHERE l.target_type = $1 AND l.target_id = $2 AND l.deleted_at IS NULL AND e.deleted_at IS NULL ORDER BY e.title COLLATE NOCASE`,
    [type, targetId],
  );
  return rows.map(map);
}

/**
 * Saves a concept from a note: creates it (or reuses an existing one with the
 * same name), and links it to the note, its lecture and its course.
 */
export async function saveConceptFromNote(
  name: string,
  definition: string,
  ctx: { noteId: string; lectureId: string | null; courseId: string | null },
): Promise<KnowledgeEntry> {
  const existing = await findEntryByName(name);
  const entry = existing ?? (await createEntry({ title: name, aliases: [], definition, formula: null, intuition: null, examples: null }));
  if (existing && !existing.definition.trim() && definition.trim()) await updateEntry(existing.id, { ...existing, definition });
  await linkEntry(entry.id, "note", ctx.noteId);
  if (ctx.lectureId) await linkEntry(entry.id, "lecture", ctx.lectureId);
  if (ctx.courseId) await linkEntry(entry.id, "course", ctx.courseId);
  return (await getEntry(entry.id))!;
}

/**
 * Turns a concept into flashcards (definition, and formula if any), linked
 * back to the concept and filed under its topic. Returns how many were made.
 */
export async function flashcardsFromEntry(entry: KnowledgeEntry, courseId: string | null): Promise<number> {
  const made: string[] = [];
  if (entry.definition.trim()) {
    made.push(await createFlashcard({ front: `What is **${entry.title}**?`, back: entry.definition, courseId, lessonId: null, noteId: null, subjectId: null, tags: [], topicName: entry.title }));
  }
  if (entry.formula?.trim()) {
    made.push(await createFlashcard({ front: `Write the formula for **${entry.title}**.`, back: `$$${entry.formula}$$`, courseId, lessonId: null, noteId: null, subjectId: null, tags: ["formula"], topicName: entry.title }));
  }
  for (const id of made) await linkEntry(entry.id, "flashcard", id);
  return made.length;
}
