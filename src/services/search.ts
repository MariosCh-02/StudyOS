/**
 * Global search over everything in StudyOS, backed by an SQLite FTS4 index
 * that triggers keep up to date (see migration 0007).
 */
import { getDb } from "@/lib/db";
import { normaliseTag } from "./tags";

export type SearchType =
  | "course"
  | "lecture"
  | "note"
  | "attachment"
  | "assignment"
  | "exam"
  | "task"
  | "event"
  | "series"
  | "flashcard"
  | "question"
  | "formula"
  | "lesson"
  | "concept"
  | "project"
  | "paper";

export const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  concept: "Knowledge base",
  course: "Courses",
  lecture: "Lectures",
  note: "Notes",
  attachment: "Files",
  assignment: "Assignments",
  exam: "Exams",
  task: "Tasks",
  event: "Calendar events",
  series: "Timetable",
  flashcard: "Flashcards",
  question: "Questions",
  formula: "Formulas",
  lesson: "Lessons",
  project: "Projects",
  paper: "Papers",
};

export interface SearchResult {
  type: SearchType;
  id: string;
  title: string;
  /** Matched text with terms wrapped in [[ ]] (rendered as highlights). */
  snippet: string;
  score: number;
}

/**
 * Turns free text into an FTS4 query: every word must match, as a prefix.
 * Terms are reduced to letters and digits and lower-cased, so quotes and FTS
 * operators (OR, NEAR, -) typed by the user can't change the query.
 */
export function buildMatchQuery(text: string): string | null {
  const terms = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 8);
  if (!terms.length) return null;
  return terms.map((t) => `${t}*`).join(" ");
}

/** Ranks a hit: title matches count most, exact title matches most of all. */
export function scoreHit(query: string, title: string, body: string): number {
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const t = title.toLowerCase();
  const b = body.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (t.includes(term)) score += 5;
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(t)) score += 3;
    const occurrences = b.split(term).length - 1;
    score += Math.min(occurrences, 10) * 0.5;
  }
  if (t === query.toLowerCase().trim()) score += 10;
  // Prefer shorter titles (more specific) a little.
  return score - Math.min(t.length, 200) / 200;
}

export interface SearchOptions {
  types?: SearchType[];
  tag?: string;
  limit?: number;
}

export async function search(text: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
  const match = buildMatchQuery(text);
  if (!match) return [];
  const db = await getDb();
  const params: (string | number)[] = [match];
  let sql = `SELECT d.entity_type AS type, d.entity_id AS id, i.title AS title, i.body AS body,
               snippet(search_index, '[[', ']]', '…', -1, 14) AS snippet
             FROM search_index i JOIN search_docs d ON d.id = i.rowid
             WHERE search_index MATCH $1`;
  if (opts.types?.length) {
    sql += ` AND d.entity_type IN (${opts.types.map((t) => {
      params.push(t);
      return `$${params.length}`;
    }).join(", ")})`;
  }
  if (opts.tag) {
    params.push(normaliseTag(opts.tag));
    sql += ` AND EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id
              WHERE l.entity_type = d.entity_type AND l.entity_id = d.entity_id AND l.deleted_at IS NULL AND t.name = $${params.length})`;
  }
  sql += " LIMIT 400";
  const rows = await db.select<{ type: SearchType; id: string; title: string; body: string; snippet: string }>(sql, params);
  return rows
    .map((r) => ({ type: r.type, id: r.id, title: r.title, snippet: r.snippet, score: scoreHit(text, r.title, r.body) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 60);
}

/** Where a result opens in the app. Some types need a lookup (e.g. a file's owner). */
export async function resultHref(r: Pick<SearchResult, "type" | "id">): Promise<string> {
  switch (r.type) {
    case "course":
      return `/studies/courses/${r.id}`;
    case "lecture":
      return `/studies/lectures/${r.id}`;
    case "note":
      return `/notes/${r.id}`;
    case "assignment":
      return `/studies/assignments/${r.id}`;
    case "exam":
      return `/studies/exams/${r.id}`;
    case "task":
      return "/tasks";
    case "event":
      return "/calendar";
    case "series":
      return "/timetable";
    case "flashcard":
      return "/flashcards";
    case "question":
      return "/practice?tab=questions";
    case "formula":
      return "/practice?tab=formulas";
    case "lesson":
      return `/practice/lessons/${r.id}`;
    case "concept":
      return `/knowledge/${r.id}`;
    case "project":
      return `/projects/${r.id}`;
    case "paper":
      return `/papers/${r.id}`;
    case "attachment": {
      const db = await getDb();
      const rows = await db.select<{ owner_type: string; owner_id: string; mime_type: string }>("SELECT owner_type, owner_id, mime_type FROM attachments WHERE id = $1", [r.id]);
      const a = rows[0];
      if (!a) return "/";
      if (a.mime_type === "application/pdf") return `/files/${r.id}`;
      return a.owner_type === "course"
        ? `/studies/courses/${a.owner_id}?tab=resources`
        : a.owner_type === "lecture"
          ? `/studies/lectures/${a.owner_id}`
          : a.owner_type === "note"
            ? `/notes/${a.owner_id}`
            : a.owner_type === "assignment"
              ? `/studies/assignments/${a.owner_id}`
              : a.owner_type === "project"
                ? `/projects/${a.owner_id}?tab=files`
                : a.owner_type === "paper"
                  ? `/papers/${a.owner_id}`
                  : `/studies/exams/${a.owner_id}`;
    }
  }
}
