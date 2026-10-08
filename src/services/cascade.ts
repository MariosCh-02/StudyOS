import type { DbDriver, SqlValue } from "@/lib/db";

/**
 * Soft-deletes everything that hangs off a set of courses: lectures, notes,
 * assignments, exams and their attachments. `courseIdsSql` is a SELECT returning course ids, using `params`.
 * The `now` timestamp is passed as the last parameter.
 */
export async function softDeleteCourseContent(db: DbDriver, courseIdsSql: string, params: SqlValue[], now: string): Promise<void> {
  const p = [...params, now];
  const t = `$${p.length}`;
  const lectureIds = `SELECT id FROM lectures WHERE course_id IN (${courseIdsSql})`;
  const noteIds = `SELECT id FROM notes WHERE course_id IN (${courseIdsSql}) OR lecture_id IN (${lectureIds})`;
  const assignmentIds = `SELECT id FROM assignments WHERE course_id IN (${courseIdsSql})`;
  const examIds = `SELECT id FROM exams WHERE course_id IN (${courseIdsSql})`;
  await db.execute(
    `UPDATE attachments SET deleted_at = ${t}, updated_at = ${t} WHERE deleted_at IS NULL AND (
       (owner_type = 'course' AND owner_id IN (${courseIdsSql})) OR
       (owner_type = 'lecture' AND owner_id IN (${lectureIds})) OR
       (owner_type = 'note' AND owner_id IN (${noteIds})) OR
       (owner_type = 'assignment' AND owner_id IN (${assignmentIds})) OR
       (owner_type = 'exam' AND owner_id IN (${examIds})))`,
    p,
  );
  await db.execute(
    `UPDATE notes SET deleted_at = ${t}, updated_at = ${t} WHERE deleted_at IS NULL
       AND (course_id IN (${courseIdsSql}) OR lecture_id IN (${lectureIds}))`,
    p,
  );
  for (const table of ["assignments", "exams"]) {
    await db.execute(`UPDATE ${table} SET deleted_at = ${t}, updated_at = ${t} WHERE deleted_at IS NULL AND course_id IN (${courseIdsSql})`, p);
  }
  await db.execute(`UPDATE lectures SET deleted_at = ${t}, updated_at = ${t} WHERE deleted_at IS NULL AND course_id IN (${courseIdsSql})`, p);
}
