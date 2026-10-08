import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import type { NoteTemplate } from "@/domain/types";
import { parseDoc, type DocNode } from "@/domain/noteContent";
import { requireText } from "@/domain/validation";

interface Row {
  id: string;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

const map = (r: Row): NoteTemplate => ({ id: r.id, name: r.name, content: r.content, createdAt: r.created_at, updatedAt: r.updated_at });

export async function listTemplates(): Promise<NoteTemplate[]> {
  const db = await getDb();
  const rows = await db.select<Row>("SELECT * FROM note_templates WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE");
  return rows.map(map);
}

export async function createTemplate(name: string, doc: DocNode): Promise<NoteTemplate> {
  const err = requireText(name, "Template name", 80);
  if (err) throw new Error(err);
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    "INSERT INTO note_templates (id, name, content, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)",
    [id, name.trim(), JSON.stringify(parseDoc(JSON.stringify(doc))), now],
  );
  return (await listTemplates()).find((t) => t.id === id)!;
}

export async function renameTemplate(id: string, name: string): Promise<void> {
  const err = requireText(name, "Template name", 80);
  if (err) throw new Error(err);
  const db = await getDb();
  await db.execute("UPDATE note_templates SET name = $2, updated_at = $3 WHERE id = $1 AND deleted_at IS NULL", [id, name.trim(), nowIso()]);
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE note_templates SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}
