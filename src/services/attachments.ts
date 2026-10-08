import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import type { Attachment, AttachmentOwnerType } from "@/domain/types";
import type { StoredFile } from "@/lib/native";

interface Row {
  id: string;
  owner_type: AttachmentOwnerType;
  owner_id: string;
  file_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  is_slides: number;
  created_at: string;
  updated_at: string;
}

const map = (r: Row): Attachment => ({
  id: r.id,
  ownerType: r.owner_type,
  ownerId: r.owner_id,
  fileName: r.file_name,
  storedName: r.stored_name,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  isSlides: r.is_slides === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface AttachmentOwner {
  type: AttachmentOwnerType;
  id: string;
}

export async function listAttachments(owner: AttachmentOwner): Promise<Attachment[]> {
  const db = await getDb();
  const rows = await db.select<Row>(
    `SELECT * FROM attachments WHERE owner_type = $1 AND owner_id = $2 AND deleted_at IS NULL
     ORDER BY is_slides DESC, created_at`,
    [owner.type, owner.id],
  );
  return rows.map(map);
}

/**
 * PDFs relevant to a note's split view, most specific first: the note's own,
 * then its lecture's (slides first), then its course's.
 */
export async function listContextPdfs(ctx: { noteId?: string | null; lectureId?: string | null; courseId?: string | null; paperId?: string | null; projectId?: string | null }): Promise<Attachment[]> {
  const db = await getDb();
  const rows = await db.select<Row>(
    `SELECT * FROM attachments WHERE deleted_at IS NULL AND mime_type = 'application/pdf'
       AND ((owner_type = 'note' AND owner_id = $1) OR (owner_type = 'lecture' AND owner_id = $2) OR (owner_type = 'course' AND owner_id = $3)
         OR (owner_type = 'paper' AND owner_id = $4) OR (owner_type = 'project' AND owner_id = $5))
     ORDER BY CASE owner_type WHEN 'paper' THEN 0 WHEN 'note' THEN 1 WHEN 'lecture' THEN 2 WHEN 'project' THEN 3 ELSE 4 END, is_slides DESC, created_at`,
    [ctx.noteId ?? "", ctx.lectureId ?? "", ctx.courseId ?? "", ctx.paperId ?? "", ctx.projectId ?? ""],
  );
  return rows.map(map);
}

export async function getAttachment(id: string): Promise<Attachment | null> {
  const db = await getDb();
  const rows = await db.select<Row>("SELECT * FROM attachments WHERE id = $1 AND deleted_at IS NULL", [id]);
  return rows[0] ? map(rows[0]) : null;
}

/** Records a file already copied into local storage by the native importer. */
export async function addAttachment(owner: AttachmentOwner, file: StoredFile, isSlides = false): Promise<Attachment> {
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO attachments (id, owner_type, owner_id, file_name, stored_name, mime_type, size_bytes, is_slides, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
    [id, owner.type, owner.id, file.fileName, file.storedName, file.mimeType, file.sizeBytes, isSlides ? 1 : 0, now],
  );
  return (await getAttachment(id))!;
}

export async function setAttachmentSlides(id: string, isSlides: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE attachments SET is_slides = $2, updated_at = $3 WHERE id = $1 AND deleted_at IS NULL", [id, isSlides ? 1 : 0, nowIso()]);
}

export async function renameAttachment(id: string, fileName: string): Promise<void> {
  const name = fileName.trim();
  if (!name || name.length > 255) throw new Error("File name must be 1–255 characters.");
  const db = await getDb();
  await db.execute("UPDATE attachments SET file_name = $2, updated_at = $3 WHERE id = $1 AND deleted_at IS NULL", [id, name, nowIso()]);
}

export async function deleteAttachment(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE attachments SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface AttachmentWithOwner extends Attachment {
  ownerTitle: string | null;
}

/** Every file in StudyOS with the name of what it's attached to (for the Files page). */
export async function listAllAttachments(): Promise<AttachmentWithOwner[]> {
  const db = await getDb();
  const rows = await db.select<Row & { owner_title: string | null }>(
    `SELECT a.*, COALESCE(c.name, l.title, n.title, s.title, e.title, p.title, pa.title) AS owner_title
     FROM attachments a
     LEFT JOIN courses c ON a.owner_type = 'course' AND c.id = a.owner_id
     LEFT JOIN lectures l ON a.owner_type = 'lecture' AND l.id = a.owner_id
     LEFT JOIN notes n ON a.owner_type = 'note' AND n.id = a.owner_id
     LEFT JOIN assignments s ON a.owner_type = 'assignment' AND s.id = a.owner_id
     LEFT JOIN exams e ON a.owner_type = 'exam' AND e.id = a.owner_id
     LEFT JOIN projects p ON a.owner_type = 'project' AND p.id = a.owner_id
     LEFT JOIN papers pa ON a.owner_type = 'paper' AND pa.id = a.owner_id
     WHERE a.deleted_at IS NULL ORDER BY a.created_at DESC`,
  );
  return rows.map((r) => ({ ...map(r), ownerTitle: r.owner_title }));
}
