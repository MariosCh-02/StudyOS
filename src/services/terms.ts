/** Academic years and the semesters (terms) inside them. */
import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import type { AcademicYear, AcademicYearInput, Semester, SemesterInput } from "@/domain/types";
import { assertValid, blankToNull, dateOrder, optionalDate, requireText } from "@/domain/validation";

interface YearRow {
  id: string;
  programme_id: string;
  label: string;
  start_date: string | null;
  end_date: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface SemesterRow {
  id: string;
  academic_year_id: string;
  label: string;
  start_date: string | null;
  end_date: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const mapYear = (r: YearRow): AcademicYear => ({
  id: r.id,
  programmeId: r.programme_id,
  label: r.label,
  startDate: r.start_date,
  endDate: r.end_date,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapSemester = (r: SemesterRow): Semester => ({
  id: r.id,
  academicYearId: r.academic_year_id,
  label: r.label,
  startDate: r.start_date,
  endDate: r.end_date,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function validatePeriod<T extends { label: string; startDate: string | null; endDate: string | null }>(input: T): T {
  assertValid({
    label: requireText(input.label, "Name", 100),
    startDate: optionalDate(input.startDate, "Start date"),
    endDate: optionalDate(input.endDate, "End date") ?? dateOrder(input.startDate, input.endDate),
  });
  return { ...input, label: input.label.trim(), startDate: blankToNull(input.startDate), endDate: blankToNull(input.endDate) };
}

// ---------------------------------------------------------------- years

export async function listAcademicYears(programmeId: string): Promise<AcademicYear[]> {
  const db = await getDb();
  const rows = await db.select<YearRow>(
    `SELECT * FROM academic_years WHERE programme_id = $1 AND deleted_at IS NULL
     ORDER BY sort_order, start_date, label COLLATE NOCASE`,
    [programmeId],
  );
  return rows.map(mapYear);
}

async function getAcademicYear(id: string): Promise<AcademicYear | null> {
  const db = await getDb();
  const rows = await db.select<YearRow>("SELECT * FROM academic_years WHERE id = $1 AND deleted_at IS NULL", [id]);
  return rows[0] ? mapYear(rows[0]) : null;
}

export async function createAcademicYear(input: Omit<AcademicYearInput, "sortOrder">): Promise<AcademicYear> {
  const v = validatePeriod(input);
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO academic_years (id, programme_id, label, start_date, end_date, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5,
       (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM academic_years WHERE programme_id = $2), $6, $6)`,
    [id, v.programmeId, v.label, v.startDate, v.endDate, now],
  );
  return (await getAcademicYear(id))!;
}

export async function updateAcademicYear(
  id: string,
  input: Pick<AcademicYearInput, "label" | "startDate" | "endDate">,
): Promise<AcademicYear> {
  const v = validatePeriod(input);
  const db = await getDb();
  await db.execute(
    "UPDATE academic_years SET label = $2, start_date = $3, end_date = $4, updated_at = $5 WHERE id = $1 AND deleted_at IS NULL",
    [id, v.label, v.startDate, v.endDate, nowIso()],
  );
  const y = await getAcademicYear(id);
  if (!y) throw new Error("Academic year not found.");
  return y;
}

/** Soft-deletes a year and its semesters. Courses stay in the programme, unassigned. */
export async function deleteAcademicYear(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute(
    `UPDATE courses SET semester_id = NULL, updated_at = $2 WHERE deleted_at IS NULL
       AND semester_id IN (SELECT id FROM semesters WHERE academic_year_id = $1)`,
    [id, now],
  );
  await db.execute("UPDATE semesters SET deleted_at = $2, updated_at = $2 WHERE academic_year_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE academic_years SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

// ------------------------------------------------------------ semesters

export async function listSemestersForProgramme(programmeId: string): Promise<Semester[]> {
  const db = await getDb();
  const rows = await db.select<SemesterRow>(
    `SELECT s.* FROM semesters s JOIN academic_years y ON y.id = s.academic_year_id
     WHERE y.programme_id = $1 AND s.deleted_at IS NULL AND y.deleted_at IS NULL
     ORDER BY y.sort_order, s.sort_order, s.start_date`,
    [programmeId],
  );
  return rows.map(mapSemester);
}

export async function getSemester(id: string): Promise<Semester | null> {
  const db = await getDb();
  const rows = await db.select<SemesterRow>("SELECT * FROM semesters WHERE id = $1 AND deleted_at IS NULL", [id]);
  return rows[0] ? mapSemester(rows[0]) : null;
}

export async function createSemester(input: Omit<SemesterInput, "sortOrder">): Promise<Semester> {
  const v = validatePeriod(input);
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO semesters (id, academic_year_id, label, start_date, end_date, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5,
       (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM semesters WHERE academic_year_id = $2), $6, $6)`,
    [id, v.academicYearId, v.label, v.startDate, v.endDate, now],
  );
  return (await getSemester(id))!;
}

export async function updateSemester(
  id: string,
  input: Pick<SemesterInput, "label" | "startDate" | "endDate">,
): Promise<Semester> {
  const v = validatePeriod(input);
  const db = await getDb();
  await db.execute(
    "UPDATE semesters SET label = $2, start_date = $3, end_date = $4, updated_at = $5 WHERE id = $1 AND deleted_at IS NULL",
    [id, v.label, v.startDate, v.endDate, nowIso()],
  );
  const s = await getSemester(id);
  if (!s) throw new Error("Semester not found.");
  return s;
}

/** Soft-deletes a semester. Its courses remain in the programme, unassigned. */
export async function deleteSemester(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE courses SET semester_id = NULL, updated_at = $2 WHERE semester_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE semesters SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

export interface SemesterOption extends Semester {
  yearLabel: string;
  programmeId: string;
  programmeName: string;
}

/** Every live semester with its year and programme, newest first (for pickers). */
export async function listAllSemesters(): Promise<SemesterOption[]> {
  const db = await getDb();
  const rows = await db.select<SemesterRow & { year_label: string; programme_id: string; programme_name: string }>(
    `SELECT s.*, y.label AS year_label, p.id AS programme_id, p.name AS programme_name
     FROM semesters s JOIN academic_years y ON y.id = s.academic_year_id JOIN programmes p ON p.id = y.programme_id
     WHERE s.deleted_at IS NULL AND y.deleted_at IS NULL AND p.deleted_at IS NULL
     ORDER BY s.start_date DESC, p.name, y.sort_order DESC, s.sort_order DESC`,
  );
  return rows.map((r) => ({ ...mapSemester(r), yearLabel: r.year_label, programmeId: r.programme_id, programmeName: r.programme_name }));
}
