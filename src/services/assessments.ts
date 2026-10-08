/** Assignments and exams: the graded components of a course. */
import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import { percentOf, standing, type Component, type Standing } from "@/domain/assessment";
import { isLocalDateTime, type LocalDateTime } from "@/domain/time";
import { assertValid, blankToNull, requireText } from "@/domain/validation";

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export const ASSIGNMENT_KINDS = ["assignment", "project", "quiz", "lab", "presentation", "participation", "other"] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];
export const ASSIGNMENT_STATUSES = ["not_started", "in_progress", "submitted", "graded"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export const EXAM_KINDS = ["midterm", "final", "quiz", "oral", "practical", "other"] as const;
export type ExamKind = (typeof EXAM_KINDS)[number];

export const ASSESSMENT_LABELS = {
  assignmentKind: { assignment: "Assignment", project: "Project", quiz: "Quiz", lab: "Lab", presentation: "Presentation", participation: "Participation", other: "Other" },
  assignmentStatus: { not_started: "Not started", in_progress: "In progress", submitted: "Submitted", graded: "Graded" },
  examKind: { midterm: "Midterm", final: "Final exam", quiz: "Quiz", oral: "Oral exam", practical: "Practical", other: "Other" },
} as const;

export interface Assignment {
  id: string;
  courseId: string;
  title: string;
  kind: AssignmentKind;
  description: string | null;
  dueAt: LocalDateTime | null;
  weight: number | null;
  status: AssignmentStatus;
  score: number | null;
  maxScore: number | null;
  checklist: ChecklistItem[];
  notes: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export type AssignmentInput = Omit<Assignment, "id" | "submittedAt" | "createdAt" | "updatedAt">;

export interface Exam {
  id: string;
  courseId: string;
  title: string;
  kind: ExamKind;
  startAt: LocalDateTime | null;
  durationMinutes: number | null;
  location: string | null;
  topics: ChecklistItem[];
  notes: string | null;
  weight: number | null;
  score: number | null;
  maxScore: number | null;
  createdAt: string;
  updatedAt: string;
}
export type ExamInput = Omit<Exam, "id" | "createdAt" | "updatedAt">;

/** Assignment or exam with its course, for cross-course lists. */
export type WithCourse<T> = T & { courseName: string; courseCode: string | null; courseColor: string | null };

function parseChecklist(json: string): ChecklistItem[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v)
      ? v.filter((x) => typeof x?.text === "string").map((x) => ({ id: String(x.id ?? newId()), text: String(x.text), done: x.done === true }))
      : [];
  } catch {
    return [];
  }
}

const cleanChecklist = (items: ChecklistItem[]) => items.map((i) => ({ id: i.id || newId(), text: i.text.trim(), done: i.done })).filter((i) => i.text);

interface AssignmentRow {
  id: string;
  course_id: string;
  title: string;
  kind: AssignmentKind;
  description: string | null;
  due_at: string | null;
  weight: number | null;
  status: AssignmentStatus;
  score: number | null;
  max_score: number | null;
  checklist: string;
  notes: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ExamRow {
  id: string;
  course_id: string;
  title: string;
  kind: ExamKind;
  start_at: string | null;
  duration_minutes: number | null;
  location: string | null;
  topics: string;
  notes: string | null;
  weight: number | null;
  score: number | null;
  max_score: number | null;
  created_at: string;
  updated_at: string;
}

interface CourseCols {
  course_name: string;
  course_code: string | null;
  course_color: string | null;
}

const mapAssignment = (r: AssignmentRow): Assignment => ({
  id: r.id,
  courseId: r.course_id,
  title: r.title,
  kind: r.kind,
  description: r.description,
  dueAt: r.due_at,
  weight: r.weight,
  status: r.status,
  score: r.score,
  maxScore: r.max_score,
  checklist: parseChecklist(r.checklist),
  notes: r.notes,
  submittedAt: r.submitted_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapExam = (r: ExamRow): Exam => ({
  id: r.id,
  courseId: r.course_id,
  title: r.title,
  kind: r.kind,
  startAt: r.start_at,
  durationMinutes: r.duration_minutes,
  location: r.location,
  topics: parseChecklist(r.topics),
  notes: r.notes,
  weight: r.weight,
  score: r.score,
  maxScore: r.max_score,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const withCourse = <T,>(r: CourseCols, v: T): WithCourse<T> => ({ ...v, courseName: r.course_name, courseCode: r.course_code, courseColor: r.course_color });

function gradeErrors(weight: number | null, score: number | null, maxScore: number | null) {
  return {
    weight: weight != null && !(weight >= 0 && weight <= 100) ? "Weight must be between 0 and 100%." : undefined,
    score: score != null && !(score >= 0) ? "Score must be zero or more." : score != null && maxScore == null ? "Enter what the score is out of." : undefined,
    maxScore: maxScore != null && !(maxScore > 0) ? "Must be more than zero." : undefined,
  };
}

// ------------------------------------------------------------ assignments

function validateAssignment(input: AssignmentInput): AssignmentInput {
  assertValid({
    courseId: input.courseId ? undefined : "Choose a course.",
    title: requireText(input.title, "Title"),
    kind: (ASSIGNMENT_KINDS as readonly string[]).includes(input.kind) ? undefined : "Choose a type.",
    status: (ASSIGNMENT_STATUSES as readonly string[]).includes(input.status) ? undefined : "Choose a status.",
    dueAt: input.dueAt && !isLocalDateTime(input.dueAt) ? "Choose a valid due date and time." : undefined,
    ...gradeErrors(input.weight, input.score, input.maxScore),
  });
  // A grade means it has been graded.
  const status: AssignmentStatus = input.score != null ? "graded" : input.status === "graded" ? "submitted" : input.status;
  return { ...input, status, title: input.title.trim(), description: blankToNull(input.description), notes: blankToNull(input.notes), dueAt: input.dueAt || null, checklist: cleanChecklist(input.checklist) };
}

const ASSIGNMENT_SELECT = `SELECT a.*, c.name AS course_name, c.code AS course_code, c.color AS course_color
  FROM assignments a JOIN courses c ON c.id = a.course_id WHERE a.deleted_at IS NULL AND c.deleted_at IS NULL`;

export async function listAssignments(filter: { courseId?: string; open?: boolean } = {}): Promise<WithCourse<Assignment>[]> {
  const db = await getDb();
  const params: string[] = [];
  let sql = ASSIGNMENT_SELECT;
  if (filter.courseId) {
    params.push(filter.courseId);
    sql += ` AND a.course_id = $${params.length}`;
  }
  if (filter.open) sql += " AND a.status IN ('not_started', 'in_progress')";
  const rows = await db.select<AssignmentRow & CourseCols>(`${sql} ORDER BY a.due_at IS NULL, a.due_at, a.title`, params);
  return rows.map((r) => withCourse(r, mapAssignment(r)));
}

export async function getAssignment(id: string): Promise<WithCourse<Assignment> | null> {
  const db = await getDb();
  const rows = await db.select<AssignmentRow & CourseCols>(`${ASSIGNMENT_SELECT} AND a.id = $1`, [id]);
  return rows[0] ? withCourse(rows[0], mapAssignment(rows[0])) : null;
}

export async function createAssignment(input: AssignmentInput): Promise<Assignment> {
  const v = validateAssignment(input);
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO assignments (id, course_id, title, kind, description, due_at, weight, status, score, max_score, checklist, notes, submitted_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
    [id, v.courseId, v.title, v.kind, v.description, v.dueAt, v.weight, v.status, v.score, v.maxScore, JSON.stringify(v.checklist), v.notes,
      v.status === "submitted" || v.status === "graded" ? now : null, now],
  );
  return (await getAssignment(id))!;
}

export async function updateAssignment(id: string, input: AssignmentInput): Promise<Assignment> {
  const v = validateAssignment(input);
  const db = await getDb();
  const now = nowIso();
  await db.execute(
    `UPDATE assignments SET course_id = $2, title = $3, kind = $4, description = $5, due_at = $6, weight = $7, status = $8, score = $9,
       max_score = $10, checklist = $11, notes = $12, updated_at = $13,
       submitted_at = CASE WHEN $8 IN ('submitted', 'graded') THEN COALESCE(submitted_at, $13) ELSE NULL END
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, v.courseId, v.title, v.kind, v.description, v.dueAt, v.weight, v.status, v.score, v.maxScore, JSON.stringify(v.checklist), v.notes, now],
  );
  const a = await getAssignment(id);
  if (!a) throw new Error("Assignment not found.");
  return a;
}

/** Quick edits from lists: status or checklist only. */
export async function patchAssignment(id: string, patch: Partial<Pick<AssignmentInput, "status" | "checklist">>): Promise<void> {
  const a = await getAssignment(id);
  if (!a) throw new Error("Assignment not found.");
  await updateAssignment(id, { ...a, ...patch });
}

export async function deleteAssignment(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE attachments SET deleted_at = $2, updated_at = $2 WHERE owner_type = 'assignment' AND owner_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE tasks SET assignment_id = NULL, updated_at = $2 WHERE assignment_id = $1", [id, now]);
  await db.execute("UPDATE assignments SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

// ------------------------------------------------------------------ exams

function validateExam(input: ExamInput): ExamInput {
  assertValid({
    courseId: input.courseId ? undefined : "Choose a course.",
    title: requireText(input.title, "Title"),
    kind: (EXAM_KINDS as readonly string[]).includes(input.kind) ? undefined : "Choose a type.",
    startAt: input.startAt && !isLocalDateTime(input.startAt) ? "Choose a valid date and time." : undefined,
    durationMinutes: input.durationMinutes != null && !(Number.isInteger(input.durationMinutes) && input.durationMinutes > 0) ? "Duration must be whole minutes." : undefined,
    ...gradeErrors(input.weight, input.score, input.maxScore),
  });
  return { ...input, title: input.title.trim(), location: blankToNull(input.location), notes: blankToNull(input.notes), startAt: input.startAt || null, topics: cleanChecklist(input.topics) };
}

const EXAM_SELECT = `SELECT e.*, c.name AS course_name, c.code AS course_code, c.color AS course_color
  FROM exams e JOIN courses c ON c.id = e.course_id WHERE e.deleted_at IS NULL AND c.deleted_at IS NULL`;

export async function listExams(filter: { courseId?: string; upcomingFrom?: LocalDateTime } = {}): Promise<WithCourse<Exam>[]> {
  const db = await getDb();
  const params: string[] = [];
  let sql = EXAM_SELECT;
  if (filter.courseId) {
    params.push(filter.courseId);
    sql += ` AND e.course_id = $${params.length}`;
  }
  if (filter.upcomingFrom) {
    params.push(filter.upcomingFrom);
    sql += ` AND e.start_at >= $${params.length}`;
  }
  const rows = await db.select<ExamRow & CourseCols>(`${sql} ORDER BY e.start_at IS NULL, e.start_at, e.title`, params);
  return rows.map((r) => withCourse(r, mapExam(r)));
}

export async function getExam(id: string): Promise<WithCourse<Exam> | null> {
  const db = await getDb();
  const rows = await db.select<ExamRow & CourseCols>(`${EXAM_SELECT} AND e.id = $1`, [id]);
  return rows[0] ? withCourse(rows[0], mapExam(rows[0])) : null;
}

export async function createExam(input: ExamInput): Promise<Exam> {
  const v = validateExam(input);
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO exams (id, course_id, title, kind, start_at, duration_minutes, location, topics, notes, weight, score, max_score, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
    [id, v.courseId, v.title, v.kind, v.startAt, v.durationMinutes, v.location, JSON.stringify(v.topics), v.notes, v.weight, v.score, v.maxScore, now],
  );
  return (await getExam(id))!;
}

export async function updateExam(id: string, input: ExamInput): Promise<Exam> {
  const v = validateExam(input);
  const db = await getDb();
  await db.execute(
    `UPDATE exams SET course_id = $2, title = $3, kind = $4, start_at = $5, duration_minutes = $6, location = $7, topics = $8, notes = $9,
       weight = $10, score = $11, max_score = $12, updated_at = $13
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, v.courseId, v.title, v.kind, v.startAt, v.durationMinutes, v.location, JSON.stringify(v.topics), v.notes, v.weight, v.score, v.maxScore, nowIso()],
  );
  const e = await getExam(id);
  if (!e) throw new Error("Exam not found.");
  return e;
}

export async function setExamTopics(id: string, topics: ChecklistItem[]): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE exams SET topics = $2, updated_at = $3 WHERE id = $1 AND deleted_at IS NULL", [id, JSON.stringify(cleanChecklist(topics)), nowIso()]);
}

export async function deleteExam(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE attachments SET deleted_at = $2, updated_at = $2 WHERE owner_type = 'exam' AND owner_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE exams SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

// --------------------------------------------------------------- standing

export interface GradedItem {
  id: string;
  kind: "assignment" | "exam";
  title: string;
  weight: number | null;
  percent: number | null;
  date: LocalDateTime | null;
}

export interface CourseStanding {
  items: GradedItem[];
  standing: Standing;
}

export function toGradedItems(assignments: Assignment[], exams: Exam[]): GradedItem[] {
  return [
    ...assignments.map((a) => ({ id: a.id, kind: "assignment" as const, title: a.title, weight: a.weight, percent: percentOf(a.score, a.maxScore), date: a.dueAt })),
    ...exams.map((e) => ({ id: e.id, kind: "exam" as const, title: e.title, weight: e.weight, percent: percentOf(e.score, e.maxScore), date: e.startAt })),
  ].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
}

export async function getCourseStanding(courseId: string): Promise<CourseStanding> {
  const [assignments, exams] = await Promise.all([listAssignments({ courseId }), listExams({ courseId })]);
  const items = toGradedItems(assignments, exams);
  return { items, standing: standing(items as Component[]) };
}
