import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import { REVISION_STATUSES, type Lecture, type LectureInput, type LectureLink, type RevisionStatus } from "@/domain/types";
import { assertValid, blankToNull, optionalDate, requireText } from "@/domain/validation";
import { getCourse } from "./courses";

interface Row {
  id: string;
  course_id: string;
  number: number | null;
  title: string;
  date: string | null;
  start_time: string | null;
  lecturer: string | null;
  links: string;
  comments: string | null;
  revision_status: RevisionStatus;
  created_at: string;
  updated_at: string;
}

function parseLinks(json: string): LectureLink[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v)
      ? v.filter((l): l is LectureLink => typeof l?.url === "string").map((l) => ({ label: String(l.label ?? ""), url: l.url }))
      : [];
  } catch {
    return [];
  }
}

const map = (r: Row): Lecture => ({
  id: r.id,
  courseId: r.course_id,
  number: r.number,
  title: r.title,
  date: r.date,
  startTime: r.start_time,
  lecturer: r.lecturer,
  links: parseLinks(r.links),
  comments: r.comments,
  revisionStatus: r.revision_status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const URL_RE = /^(https?:\/\/|mailto:)\S+$/i;

function validate(input: LectureInput): LectureInput {
  const badLink = input.links.find((l) => !URL_RE.test(l.url.trim()));
  assertValid({
    courseId: input.courseId ? undefined : "Choose a course.",
    title: requireText(input.title, "Topic"),
    number: input.number != null && (!Number.isInteger(input.number) || input.number < 0) ? "Number must be a whole number." : undefined,
    date: optionalDate(input.date, "Date"),
    startTime: input.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime) ? "Time must be HH:MM." : undefined,
    revisionStatus: REVISION_STATUSES.includes(input.revisionStatus) ? undefined : "Choose a revision status.",
    links: badLink ? `"${badLink.url}" isn't a valid link (use http:// or https://).` : undefined,
  });
  return {
    ...input,
    title: input.title.trim(),
    date: blankToNull(input.date),
    startTime: blankToNull(input.startTime),
    lecturer: blankToNull(input.lecturer),
    comments: blankToNull(input.comments),
    links: input.links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
  };
}

export async function listLectures(courseId: string): Promise<Lecture[]> {
  const db = await getDb();
  const rows = await db.select<Row>(
    `SELECT * FROM lectures WHERE course_id = $1 AND deleted_at IS NULL
     ORDER BY number IS NULL, number, date, created_at`,
    [courseId],
  );
  return rows.map(map);
}

export interface LectureWithCourse extends Lecture {
  courseName: string;
  courseCode: string | null;
  courseColor: string | null;
}

/** Lectures on a given date across all live courses (for the dashboard). */
export async function listLecturesOn(date: string): Promise<LectureWithCourse[]> {
  const db = await getDb();
  const rows = await db.select<Row & { course_name: string; course_code: string | null; course_color: string | null }>(
    `SELECT l.*, c.name AS course_name, c.code AS course_code, c.color AS course_color
     FROM lectures l JOIN courses c ON c.id = l.course_id
     WHERE l.date = $1 AND l.deleted_at IS NULL AND c.deleted_at IS NULL
     ORDER BY l.start_time IS NULL, l.start_time, c.name`,
    [date],
  );
  return rows.map((r) => ({ ...map(r), courseName: r.course_name, courseCode: r.course_code, courseColor: r.course_color }));
}

export async function getLecture(id: string): Promise<Lecture | null> {
  const db = await getDb();
  const rows = await db.select<Row>("SELECT * FROM lectures WHERE id = $1 AND deleted_at IS NULL", [id]);
  return rows[0] ? map(rows[0]) : null;
}

export async function nextLectureNumber(courseId: string): Promise<number> {
  const db = await getDb();
  const r = await db.select<{ n: number | null }>(
    "SELECT MAX(number) AS n FROM lectures WHERE course_id = $1 AND deleted_at IS NULL",
    [courseId],
  );
  return (r[0]?.n ?? 0) + 1;
}

export async function createLecture(input: LectureInput): Promise<Lecture> {
  const v = validate(input);
  if (!(await getCourse(v.courseId))) throw new Error("Course not found.");
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO lectures (id, course_id, number, title, date, start_time, lecturer, links, comments, revision_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
    [id, v.courseId, v.number, v.title, v.date, v.startTime, v.lecturer, JSON.stringify(v.links), v.comments, v.revisionStatus, now],
  );
  return (await getLecture(id))!;
}

export async function updateLecture(id: string, input: LectureInput): Promise<Lecture> {
  const v = validate(input);
  const db = await getDb();
  await db.execute(
    `UPDATE lectures SET course_id = $2, number = $3, title = $4, date = $5, start_time = $6, lecturer = $7, links = $8,
       comments = $9, revision_status = $10, updated_at = $11
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, v.courseId, v.number, v.title, v.date, v.startTime, v.lecturer, JSON.stringify(v.links), v.comments, v.revisionStatus, nowIso()],
  );
  const l = await getLecture(id);
  if (!l) throw new Error("Lecture not found.");
  return l;
}

export async function setRevisionStatus(id: string, status: RevisionStatus): Promise<void> {
  if (!REVISION_STATUSES.includes(status)) throw new Error("Invalid revision status.");
  const db = await getDb();
  await db.execute("UPDATE lectures SET revision_status = $2, updated_at = $3 WHERE id = $1 AND deleted_at IS NULL", [id, status, nowIso()]);
}

/** Soft-deletes a lecture together with its notes and attachments. */
export async function deleteLecture(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute(
    `UPDATE attachments SET deleted_at = $2, updated_at = $2 WHERE deleted_at IS NULL AND (
       (owner_type = 'lecture' AND owner_id = $1) OR
       (owner_type = 'note' AND owner_id IN (SELECT id FROM notes WHERE lecture_id = $1)))`,
    [id, now],
  );
  await db.execute("UPDATE notes SET deleted_at = $2, updated_at = $2 WHERE lecture_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE lectures SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

/**
 * The course's lecture on `date`, or a new one numbered after the last,
 * titled "Lecture N", with the course lecturer (and the class start time,
 * when opened from the timetable).
 */
export async function getOrCreateLectureForDate(courseId: string, date: string, startTime: string | null = null): Promise<Lecture> {
  const existing = (await listLectures(courseId)).filter((l) => l.date === date);
  if (existing.length) return existing[existing.length - 1]!;
  const course = await getCourse(courseId);
  if (!course) throw new Error("Course not found.");
  const number = await nextLectureNumber(courseId);
  return createLecture({
    courseId,
    number,
    title: `Lecture ${number}`,
    date,
    startTime,
    lecturer: course.lecturer,
    links: [],
    comments: null,
    revisionStatus: "not_reviewed",
  });
}

/** Quick Lecture Mode entry point: today's lecture for a course. */
export const getOrCreateTodaysLecture = (courseId: string, today: string): Promise<Lecture> => getOrCreateLectureForDate(courseId, today);
