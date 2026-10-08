import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import { PROGRAMME_LEVELS, PROGRAMME_STATUSES, type Programme, type ProgrammeInput } from "@/domain/types";
import { isValidGrade, parseGradingScale, validateGradingScale } from "@/domain/grading";
import { assertValid, blankToNull, dateOrder, optionalDate, optionalNonNegative, requireText } from "@/domain/validation";
import { getSetting, setSetting } from "./settings";
import { softDeleteCourseContent } from "./cascade";

interface Row {
  id: string;
  institution_id: string;
  name: string;
  level: Programme["level"];
  status: Programme["status"];
  field: string | null;
  start_date: string | null;
  end_date: string | null;
  total_credits: number | null;
  credit_unit: string;
  grading_scale: string;
  target_grade: number | null;
  color: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  institution_name: string;
}

export interface ProgrammeWithInstitution extends Programme {
  institutionName: string;
}

const map = (r: Row): ProgrammeWithInstitution => ({
  id: r.id,
  institutionId: r.institution_id,
  institutionName: r.institution_name,
  name: r.name,
  level: r.level,
  status: r.status,
  field: r.field,
  startDate: r.start_date,
  endDate: r.end_date,
  totalCredits: r.total_credits,
  creditUnit: r.credit_unit,
  gradingScale: parseGradingScale(r.grading_scale),
  targetGrade: r.target_grade,
  color: r.color,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function validate(input: ProgrammeInput): ProgrammeInput {
  const scaleErrors = validateGradingScale(input.gradingScale);
  assertValid({
    name: requireText(input.name, "Name"),
    institutionId: input.institutionId ? undefined : "Choose an institution.",
    level: PROGRAMME_LEVELS.includes(input.level) ? undefined : "Choose a level.",
    status: PROGRAMME_STATUSES.includes(input.status) ? undefined : "Choose a status.",
    startDate: optionalDate(input.startDate, "Start date"),
    endDate: optionalDate(input.endDate, "End date") ?? dateOrder(input.startDate, input.endDate),
    totalCredits: optionalNonNegative(input.totalCredits, "Total credits"),
    gradingScale: scaleErrors[0],
    targetGrade:
      input.targetGrade != null && scaleErrors.length === 0 && !isValidGrade(input.gradingScale, input.targetGrade)
        ? `Target must be between ${input.gradingScale.min} and ${input.gradingScale.max}.`
        : undefined,
    creditUnit: requireText(input.creditUnit, "Credit unit", 20),
  });
  return {
    ...input,
    name: input.name.trim(),
    field: blankToNull(input.field),
    startDate: blankToNull(input.startDate),
    endDate: blankToNull(input.endDate),
    creditUnit: input.creditUnit.trim(),
    color: blankToNull(input.color),
    notes: blankToNull(input.notes),
  };
}

const SELECT_WITH_INSTITUTION = `
  SELECT p.*, i.name AS institution_name
  FROM programmes p JOIN institutions i ON i.id = p.institution_id
  WHERE p.deleted_at IS NULL AND i.deleted_at IS NULL`;

const STATUS_ORDER =
  "CASE p.status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 WHEN 'paused' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END";

export async function listProgrammes(): Promise<ProgrammeWithInstitution[]> {
  const db = await getDb();
  const rows = await db.select<Row>(
    `${SELECT_WITH_INSTITUTION} ORDER BY ${STATUS_ORDER}, p.start_date DESC, p.name COLLATE NOCASE`,
  );
  return rows.map(map);
}

export async function getProgramme(id: string): Promise<ProgrammeWithInstitution | null> {
  const db = await getDb();
  const rows = await db.select<Row>(`${SELECT_WITH_INSTITUTION} AND p.id = $1`, [id]);
  return rows[0] ? map(rows[0]) : null;
}

export async function createProgramme(input: ProgrammeInput): Promise<ProgrammeWithInstitution> {
  const v = validate(input);
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO programmes (id, institution_id, name, level, status, field, start_date, end_date, total_credits,
       credit_unit, grading_scale, target_grade, color, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
    [id, v.institutionId, v.name, v.level, v.status, v.field, v.startDate, v.endDate, v.totalCredits,
      v.creditUnit, JSON.stringify(v.gradingScale), v.targetGrade, v.color, v.notes, now],
  );
  // The first programme a user creates becomes the active one.
  if (!(await getSetting("activeProgrammeId"))) await setSetting("activeProgrammeId", id);
  return (await getProgramme(id))!;
}

export async function updateProgramme(id: string, input: ProgrammeInput): Promise<ProgrammeWithInstitution> {
  const v = validate(input);
  const db = await getDb();
  await db.execute(
    `UPDATE programmes SET institution_id = $2, name = $3, level = $4, status = $5, field = $6, start_date = $7,
       end_date = $8, total_credits = $9, credit_unit = $10, grading_scale = $11, target_grade = $12, color = $13,
       notes = $14, updated_at = $15
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, v.institutionId, v.name, v.level, v.status, v.field, v.startDate, v.endDate, v.totalCredits,
      v.creditUnit, JSON.stringify(v.gradingScale), v.targetGrade, v.color, v.notes, nowIso()],
  );
  const updated = await getProgramme(id);
  if (!updated) throw new Error("Programme not found.");
  return updated;
}

/** Soft-deletes a programme and everything beneath it. */
export async function softDeleteProgrammeTree(id: string, now: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE semesters SET deleted_at = $2, updated_at = $2 WHERE deleted_at IS NULL
       AND academic_year_id IN (SELECT id FROM academic_years WHERE programme_id = $1)`,
    [id, now],
  );
  await db.execute(
    "UPDATE academic_years SET deleted_at = $2, updated_at = $2 WHERE programme_id = $1 AND deleted_at IS NULL",
    [id, now],
  );
  await softDeleteCourseContent(db, "SELECT id FROM courses WHERE programme_id = $1 AND deleted_at IS NULL", [id], now);
  await db.execute("UPDATE courses SET deleted_at = $2, updated_at = $2 WHERE programme_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE programmes SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

export async function deleteProgramme(id: string): Promise<void> {
  await softDeleteProgrammeTree(id, nowIso());
  await repairActiveProgramme();
}

/** Ensures the active-programme setting points at a live programme. */
export async function repairActiveProgramme(): Promise<string | null> {
  const current = await getSetting("activeProgrammeId");
  if (current && (await getProgramme(current))) return current;
  const db = await getDb();
  const next = await db.select<{ id: string }>(
    `SELECT p.id FROM programmes p JOIN institutions i ON i.id = p.institution_id
     WHERE p.deleted_at IS NULL AND i.deleted_at IS NULL ORDER BY ${STATUS_ORDER}, p.created_at LIMIT 1`,
  );
  const id = next[0]?.id ?? null;
  await setSetting("activeProgrammeId", id ?? "");
  return id;
}
