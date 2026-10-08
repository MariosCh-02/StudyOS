/** Tags (#exam, #confusing, …) on any item, including #hashtags typed in notes. */
import { getDb } from "@/lib/db";
import { nowIso } from "@/lib/ids";

export const SUGGESTED_TAGS = ["exam", "important", "review", "confusing", "formula", "assignment", "research", "project"];

/** Things that can carry tags; matches the search index entity types. */
export type TaggableType = "note" | "lecture" | "assignment" | "exam" | "task" | "flashcard" | "question" | "formula" | "concept" | "course" | "lesson";

export interface TagSummary {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

export const normaliseTag = (name: string) =>
  name
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .slice(0, 40);

/** Hashtags in plain text, e.g. "#confusing" or "#exam-2". */
export function extractHashtags(text: string): string[] {
  const tags = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s(])#([\p{L}][\p{L}\p{N}_-]{1,39})/gu)) tags.add(normaliseTag(m[1]!));
  return [...tags];
}

/** Tag ids are derived from the name so the same tag created on two devices is one row. */
export async function ensureTag(name: string): Promise<string> {
  const n = normaliseTag(name);
  if (!n) throw new Error("Tag can't be empty.");
  const db = await getDb();
  // Several rows can share a name (created on different devices): prefer a live one with the canonical id.
  const existing = await db.select<{ id: string; deleted_at: string | null }>(
    "SELECT id, deleted_at FROM tags WHERE name = $1 COLLATE NOCASE ORDER BY deleted_at IS NOT NULL, id <> $2, id LIMIT 1",
    [n, `tag:${n}`],
  );
  const now = nowIso();
  if (existing[0]) {
    if (existing[0].deleted_at) await db.execute("UPDATE tags SET deleted_at = NULL, updated_at = $2 WHERE id = $1", [existing[0].id, now]);
    return existing[0].id;
  }
  const id = `tag:${n}`;
  await db.execute("INSERT INTO tags (id, name, color, created_at, updated_at) VALUES ($1, $2, NULL, $3, $3)", [id, n, now]);
  return id;
}

export async function listTags(): Promise<TagSummary[]> {
  const db = await getDb();
  return db.select<TagSummary>(
    // Tags with the same name (created on different devices) are shown as one.
    `SELECT COALESCE(MAX(CASE WHEN t.id = 'tag:' || lower(t.name) THEN t.id END), MIN(t.id)) AS id, lower(t.name) AS name,
       MAX(t.color) AS color, COUNT(DISTINCT l.entity_type || '|' || l.entity_id) AS count FROM tags t
     LEFT JOIN tag_links l ON l.tag_id = t.id AND l.deleted_at IS NULL
     WHERE t.deleted_at IS NULL GROUP BY lower(t.name) ORDER BY count DESC, name`,
  );
}

export async function tagsFor(type: TaggableType, id: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ name: string }>(
    `SELECT DISTINCT t.name FROM tag_links l JOIN tags t ON t.id = l.tag_id
     WHERE l.entity_type = $1 AND l.entity_id = $2 AND l.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY t.name`,
    [type, id],
  );
  return rows.map((r) => r.name);
}

export interface TagLink {
  name: string;
  source: "manual" | "inline";
}

/** Tags on an item with where they came from (inline = #hashtag in the note text). */
export async function tagLinksFor(type: TaggableType, id: string): Promise<TagLink[]> {
  const db = await getDb();
  return db.select<TagLink>(
    `SELECT t.name, l.source FROM tag_links l JOIN tags t ON t.id = l.tag_id
     WHERE l.entity_type = $1 AND l.entity_id = $2 AND l.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY t.name`,
    [type, id],
  );
}

/** Replaces the tags of one source (manual or inline) on an item. */
export async function setTags(type: TaggableType, id: string, names: string[], source: "manual" | "inline" = "manual"): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  const wanted = new Set<string>();
  for (const n of names.map(normaliseTag).filter(Boolean)) wanted.add(await ensureTag(n));
  const current = await db.select<{ id: string; tag_id: string }>(
    "SELECT id, tag_id FROM tag_links WHERE entity_type = $1 AND entity_id = $2 AND source = $3 AND deleted_at IS NULL",
    [type, id, source],
  );
  for (const link of current) {
    if (!wanted.has(link.tag_id)) await db.execute("UPDATE tag_links SET deleted_at = $2, updated_at = $2 WHERE id = $1", [link.id, now]);
  }
  for (const tagId of wanted) {
    if (current.some((c) => c.tag_id === tagId)) continue;
    await db.execute(
      `INSERT INTO tag_links (id, tag_id, entity_type, entity_id, source, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at`,
      [`${tagId}|${type}|${id}|${source}`, tagId, type, id, source, now],
    );
  }
}

/** Keeps a note's #hashtags in sync with its tag links. */
export const syncInlineTags = (noteId: string, text: string) => setTags("note", noteId, extractHashtags(text), "inline");

export interface TaggedItem {
  type: TaggableType;
  id: string;
  title: string;
}

/** Everything carrying a tag, with titles from the search index. */
export async function itemsWithTag(name: string): Promise<TaggedItem[]> {
  const db = await getDb();
  return db.select<TaggedItem>(
    `SELECT DISTINCT l.entity_type AS type, l.entity_id AS id, i.title AS title
     FROM tag_links l JOIN tags t ON t.id = l.tag_id
     JOIN search_docs d ON d.entity_type = l.entity_type AND d.entity_id = l.entity_id
     JOIN search_index i ON i.rowid = d.id
     WHERE t.name = $1 COLLATE NOCASE AND t.deleted_at IS NULL AND l.deleted_at IS NULL
     ORDER BY l.entity_type, i.title`,
    [normaliseTag(name)],
  );
}
