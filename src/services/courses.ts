import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import { COURSE_STATUSES, type Course, type CourseInput } from "@/domain/types";
import { isValidGrade, type GradingScale } from "@/domain/grading";
import { assertValid, blankToNull, optionalNonNegative, requireText } from "@/domain/validation";
import { getProgramme } from "./programmes";
import { softDeleteCourseContent } from "./cascade";

interface Row {
  id: string;
  programme_id: string;
  semester_id: string | null;
  name: string;
  code: string | null;
  credits: number | null;
  lecturer: string | null;
  lecturer_email: string | null;
  location: string | null;
  status: Course["status"];
  final_grade: number | null;
  target_grade: number | null;
  color: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

const map = (r: Row): Course => ({
  id: r.id,
  programmeId: r.programme_id,
  semesterId: r.semester_id,
  name: r.name,
  code: r.code,
  credits: r.credits,
  lecturer: r.lecturer,
  lecturerEmail: r.lecturer_email,
  location: r.location,
  status: r.status,
  finalGrade: r.final_grade,
  targetGrade: r.target_grade,
  color: r.color,
  description: r.description,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const gradeError = (scale: GradingScale, value: number | null, label: string) =>
  value != null && !isValidGrade(scale, value) ? `${label} must be between ${scale.min} and ${scale.max}.` : undefined;

async function validate(input: CourseInput): Promise<CourseInput> {
  const programme = input.programmeId ? await getProgramme(input.programmeId) : null;
  const scale = programme?.gradingScale;
  let semesterError: string | undefined;
  if (input.semesterId && programme) {
    const db = await getDb();
    const owned = await db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM semesters s JOIN academic_years y ON y.id = s.academic_year_id
       WHERE s.id = $1 AND y.programme_id = $2 AND s.deleted_at IS NULL`,
      [input.semesterId, programme.id],
    );
    if (!owned[0]?.n) semesterError = "Semester does not belong to this programme.";
  }
  assertValid({
    programmeId: programme ? undefined : "Choose a programme.",
    semesterId: semesterError,
    name: requireText(input.name, "Course name"),
    code: input.code && input.code.length > 40 ? "Course code must be at most 40 characters." : undefined,
    credits: optionalNonNegative(input.credits, "Credits"),
    status: COURSE_STATUSES.includes(input.status) ? undefined : "Choose a status.",
    lecturerEmail:
      input.lecturerEmail && input.lecturerEmail.trim() && !/^\S+@\S+\.\S+$/.test(input.lecturerEmail.trim())
        ? "Enter a valid email address."
        : undefined,
    finalGrade: scale ? gradeError(scale, input.finalGrade, "Final grade") : undefined,
    targetGrade: scale ? gradeError(scale, input.targetGrade, "Target grade") : undefined,
  });
  return {
    ...input,
    name: input.name.trim(),
    code: blankToNull(input.code),
    lecturer: blankToNull(input.lecturer),
    lecturerEmail: blankToNull(input.lecturerEmail),
    location: blankToNull(input.location),
    color: blankToNull(input.color),
    description: blankToNull(input.description),
    semesterId: input.semesterId || null,
  };
}

export interface CourseFilter {
  programmeId?: string;
  semesterId?: string;
}

export async function listCourses(filter: CourseFilter = {}): Promise<Course[]> {
  const db = await getDb();
  const clauses = ["deleted_at IS NULL"];
  const params: string[] = [];
  if (filter.programmeId) {
    params.push(filter.programmeId);
    clauses.push(`programme_id = $${params.length}`);
  }
  if (filter.semesterId) {
    params.push(filter.semesterId);
    clauses.push(`semester_id = $${params.length}`);
  }
  const rows = await db.select<Row>(
    `SELECT * FROM courses WHERE ${clauses.join(" AND ")} ORDER BY code COLLATE NOCASE, name COLLATE NOCASE`,
    params,
  );
  return rows.map(map);
}

export async function getCourse(id: string): Promise<Course | null> {
  const db = await getDb();
  const rows = await db.select<Row>("SELECT * FROM courses WHERE id = $1 AND deleted_at IS NULL", [id]);
  return rows[0] ? map(rows[0]) : null;
}

export async function createCourse(input: CourseInput): Promise<Course> {
  const v = await validate(input);
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO courses (id, programme_id, semester_id, name, code, credits, lecturer, lecturer_email, location,
       status, final_grade, target_grade, color, description, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
    [id, v.programmeId, v.semesterId, v.name, v.code, v.credits, v.lecturer, v.lecturerEmail, v.location,
      v.status, v.finalGrade, v.targetGrade, v.color, v.description, now],
  );
  return (await getCourse(id))!;
}

export async function updateCourse(id: string, input: CourseInput): Promise<Course> {
  const v = await validate(input);
  const db = await getDb();
  await db.execute(
    `UPDATE courses SET programme_id = $2, semester_id = $3, name = $4, code = $5, credits = $6, lecturer = $7,
       lecturer_email = $8, location = $9, status = $10, final_grade = $11, target_grade = $12, color = $13,
       description = $14, updated_at = $15
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, v.programmeId, v.semesterId, v.name, v.code, v.credits, v.lecturer, v.lecturerEmail, v.location,
      v.status, v.finalGrade, v.targetGrade, v.color, v.description, nowIso()],
  );
  const c = await getCourse(id);
  if (!c) throw new Error("Course not found.");
  return c;
}

/** Soft-deletes a course with its lectures, notes and attachments. */
export async function deleteCourse(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await softDeleteCourseContent(db, "SELECT $1", [id], now);
  await db.execute("UPDATE courses SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}
