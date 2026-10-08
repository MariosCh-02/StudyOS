import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import { INSTITUTION_KINDS, type Institution, type InstitutionInput } from "@/domain/types";
import { assertValid, blankToNull, requireText } from "@/domain/validation";
import { repairActiveProgramme, softDeleteProgrammeTree } from "./programmes";

interface Row {
  id: string;
  name: string;
  kind: Institution["kind"];
  country: string | null;
  website: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const map = (r: Row): Institution => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  country: r.country,
  website: r.website,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function validate(input: InstitutionInput): InstitutionInput {
  assertValid({
    name: requireText(input.name, "Name"),
    kind: INSTITUTION_KINDS.includes(input.kind) ? undefined : "Choose an institution type.",
    website:
      input.website && input.website.trim() && !/^https?:\/\/\S+$/i.test(input.website.trim())
        ? "Website must start with http:// or https://"
        : undefined,
  });
  return {
    ...input,
    name: input.name.trim(),
    country: blankToNull(input.country),
    website: blankToNull(input.website),
    notes: blankToNull(input.notes),
  };
}

export async function listInstitutions(): Promise<Institution[]> {
  const db = await getDb();
  const rows = await db.select<Row>("SELECT * FROM institutions WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE");
  return rows.map(map);
}

export async function getInstitution(id: string): Promise<Institution | null> {
  const db = await getDb();
  const rows = await db.select<Row>("SELECT * FROM institutions WHERE id = $1 AND deleted_at IS NULL", [id]);
  return rows[0] ? map(rows[0]) : null;
}

export async function createInstitution(input: InstitutionInput): Promise<Institution> {
  const v = validate(input);
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO institutions (id, name, kind, country, website, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [id, v.name, v.kind, v.country, v.website, v.notes, now],
  );
  return (await getInstitution(id))!;
}

export async function updateInstitution(id: string, input: InstitutionInput): Promise<Institution> {
  const v = validate(input);
  const db = await getDb();
  await db.execute(
    `UPDATE institutions SET name = $2, kind = $3, country = $4, website = $5, notes = $6, updated_at = $7
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, v.name, v.kind, v.country, v.website, v.notes, nowIso()],
  );
  const updated = await getInstitution(id);
  if (!updated) throw new Error("Institution not found.");
  return updated;
}

/** Soft-deletes the institution together with its programmes and their contents. */
export async function deleteInstitution(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  const programmes = await db.select<{ id: string }>(
    "SELECT id FROM programmes WHERE institution_id = $1 AND deleted_at IS NULL",
    [id],
  );
  for (const p of programmes) await softDeleteProgrammeTree(p.id, now);
  await db.execute("UPDATE institutions SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
  await repairActiveProgramme();
}
