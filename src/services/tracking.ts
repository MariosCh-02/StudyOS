/** Tasks, attendance and study sessions. */
import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import { attendanceStats, type AttendanceStats, type AttendanceStatus } from "@/domain/tracking";
import { expandRule } from "@/domain/recurrence";
import { dateOf, isLocalDateTime, type DateKey, type LocalDateTime } from "@/domain/time";
import { isDateKey } from "@/domain/dates";
import { assertValid, blankToNull, requireText } from "@/domain/validation";
import { listExceptions, listRecurring } from "./calendar";

// ------------------------------------------------------------------ tasks

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_LABELS = {
  priority: { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" },
  status: { todo: "To do", in_progress: "In progress", done: "Done" },
} as const;

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  courseId: string | null;
  assignmentId: string | null;
  projectId: string | null;
  dueAt: LocalDateTime | null;
  priority: TaskPriority;
  status: TaskStatus;
  estimatedMinutes: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  courseName: string | null;
  courseCode: string | null;
  courseColor: string | null;
  projectTitle: string | null;
}
/** `projectId` left undefined keeps the current project link when updating. */
export type TaskInput = Pick<Task, "title" | "notes" | "courseId" | "assignmentId" | "dueAt" | "priority" | "status" | "estimatedMinutes"> & { projectId?: string | null };

interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  course_id: string | null;
  assignment_id: string | null;
  project_id: string | null;
  due_at: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  estimated_minutes: number | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  course_name: string | null;
  course_code: string | null;
  course_color: string | null;
  project_title: string | null;
}

const mapTask = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  courseId: r.course_id,
  assignmentId: r.assignment_id,
  projectId: r.project_id,
  dueAt: r.due_at,
  priority: r.priority,
  status: r.status,
  estimatedMinutes: r.estimated_minutes,
  completedAt: r.completed_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  courseName: r.course_name,
  courseCode: r.course_code,
  courseColor: r.course_color,
  projectTitle: r.project_title,
});

function validateTask(input: TaskInput): TaskInput {
  assertValid({
    title: requireText(input.title, "Task"),
    dueAt: input.dueAt && !isLocalDateTime(input.dueAt) ? "Choose a valid due date." : undefined,
    priority: (TASK_PRIORITIES as readonly string[]).includes(input.priority) ? undefined : "Choose a priority.",
    status: (TASK_STATUSES as readonly string[]).includes(input.status) ? undefined : "Choose a status.",
    estimatedMinutes:
      input.estimatedMinutes != null && !(Number.isInteger(input.estimatedMinutes) && input.estimatedMinutes > 0) ? "Estimate must be whole minutes." : undefined,
  });
  return { ...input, title: input.title.trim(), notes: blankToNull(input.notes), courseId: input.courseId || null, assignmentId: input.assignmentId || null, projectId: input.projectId === undefined ? undefined : input.projectId || null, dueAt: input.dueAt || null };
}

const TASK_SELECT = `SELECT t.*, c.name AS course_name, c.code AS course_code, c.color AS course_color, p.title AS project_title
  FROM tasks t LEFT JOIN courses c ON c.id = t.course_id AND c.deleted_at IS NULL
  LEFT JOIN projects p ON p.id = t.project_id AND p.deleted_at IS NULL WHERE t.deleted_at IS NULL`;

const PRIORITY_ORDER = "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END";

export async function listTasks(filter: { courseId?: string; projectId?: string; open?: boolean; doneSince?: string } = {}): Promise<Task[]> {
  const db = await getDb();
  const params: string[] = [];
  let sql = TASK_SELECT;
  if (filter.projectId) {
    params.push(filter.projectId);
    sql += ` AND t.project_id = $${params.length}`;
  }
  if (filter.courseId) {
    params.push(filter.courseId);
    sql += ` AND t.course_id = $${params.length}`;
  }
  if (filter.open) sql += " AND t.status != 'done'";
  if (filter.doneSince) {
    params.push(filter.doneSince);
    sql += ` AND (t.status != 'done' OR t.completed_at >= $${params.length})`;
  }
  const rows = await db.select<TaskRow>(`${sql} ORDER BY t.status = 'done', t.due_at IS NULL, t.due_at, ${PRIORITY_ORDER}, t.created_at`, params);
  return rows.map(mapTask);
}

async function getTask(id: string): Promise<Task | null> {
  const db = await getDb();
  const rows = await db.select<TaskRow>(`${TASK_SELECT} AND t.id = $1`, [id]);
  return rows[0] ? mapTask(rows[0]) : null;
}

export async function createTask(input: TaskInput): Promise<Task> {
  const v = validateTask(input);
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO tasks (id, title, notes, course_id, assignment_id, project_id, due_at, priority, status, estimated_minutes, completed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
    [id, v.title, v.notes, v.courseId, v.assignmentId, v.projectId ?? null, v.dueAt, v.priority, v.status, v.estimatedMinutes, v.status === "done" ? now : null, now],
  );
  return (await getTask(id))!;
}

export async function updateTask(id: string, input: TaskInput): Promise<Task> {
  const v = validateTask(input);
  const db = await getDb();
  const now = nowIso();
  await db.execute(
    `UPDATE tasks SET title = $2, notes = $3, course_id = $4, assignment_id = $5, due_at = $6, priority = $7, status = $8,
       estimated_minutes = $9, updated_at = $10, project_id = CASE WHEN $12 = 1 THEN $11 ELSE project_id END,
       completed_at = CASE WHEN $8 = 'done' THEN COALESCE(completed_at, $10) ELSE NULL END
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, v.title, v.notes, v.courseId, v.assignmentId, v.dueAt, v.priority, v.status, v.estimatedMinutes, now, v.projectId ?? null, v.projectId === undefined ? 0 : 1],
  );
  const t = await getTask(id);
  if (!t) throw new Error("Task not found.");
  return t;
}

export async function setTaskStatus(id: string, status: TaskStatus): Promise<void> {
  const t = await getTask(id);
  if (!t) throw new Error("Task not found.");
  await updateTask(id, { ...t, status });
}

export async function deleteTask(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE tasks SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

// ------------------------------------------------------------- attendance

export interface AttendanceRecord {
  id: string;
  courseId: string;
  date: DateKey;
  status: AttendanceStatus;
  lectureId: string | null;
  note: string | null;
  updatedAt: string;
}

export async function listAttendance(courseId: string): Promise<AttendanceRecord[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; course_id: string; date: string; status: AttendanceStatus; lecture_id: string | null; note: string | null; updated_at: string }>(
    "SELECT * FROM attendance WHERE course_id = $1 AND deleted_at IS NULL ORDER BY date, updated_at",
    [courseId],
  );
  return rows.map((r) => ({ id: r.id, courseId: r.course_id, date: r.date, status: r.status, lectureId: r.lecture_id, note: r.note, updatedAt: r.updated_at }));
}

/** Records attendance for a class date, replacing any earlier record for it. */
export async function recordAttendance(courseId: string, date: DateKey, status: AttendanceStatus, lectureId: string | null = null): Promise<void> {
  if (!isDateKey(date)) throw new Error("Invalid date.");
  if (!["present", "late", "absent", "excused"].includes(status)) throw new Error("Invalid attendance status.");
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE attendance SET deleted_at = $3, updated_at = $3 WHERE course_id = $1 AND date = $2 AND deleted_at IS NULL", [courseId, date, now]);
  await db.execute(
    "INSERT INTO attendance (id, course_id, date, status, lecture_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)",
    [newId(), courseId, date, status, lectureId, now],
  );
}

export async function clearAttendance(courseId: string, date: DateKey): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE attendance SET deleted_at = $3, updated_at = $3 WHERE course_id = $1 AND date = $2 AND deleted_at IS NULL", [courseId, date, now]);
}

/** Dates this course was scheduled on the timetable up to and including `until`. */
export async function scheduledClassDates(courseId: string, until: DateKey): Promise<DateKey[]> {
  const series = await listRecurring({ type: "class", courseId });
  const dates = new Set<DateKey>();
  for (const s of series) {
    if (s.startDate > until) continue;
    for (const o of expandRule(s, await listExceptions(s.id), s.startDate, until)) dates.add(dateOf(o.start));
  }
  return [...dates].sort();
}

export interface CourseAttendance {
  records: AttendanceRecord[];
  scheduled: DateKey[];
  stats: AttendanceStats;
}

export async function getCourseAttendance(courseId: string, today: DateKey): Promise<CourseAttendance> {
  const [records, scheduled] = await Promise.all([listAttendance(courseId), scheduledClassDates(courseId, today)]);
  return { records, scheduled, stats: attendanceStats(records, scheduled) };
}

// ---------------------------------------------------------- study sessions

export type SessionKind = "timer" | "lecture" | "manual";

export interface StudySession {
  id: string;
  start: LocalDateTime;
  minutes: number;
  kind: SessionKind;
  mode: string | null;
  programmeId: string | null;
  courseId: string | null;
  lectureId: string | null;
  taskId: string | null;
  topic: string | null;
  notes: string | null;
  courseName: string | null;
  courseColor: string | null;
}
export type StudySessionInput = Omit<StudySession, "id" | "courseName" | "courseColor">;

interface SessionRow {
  id: string;
  started_at: string;
  minutes: number;
  kind: SessionKind;
  mode: string | null;
  programme_id: string | null;
  course_id: string | null;
  lecture_id: string | null;
  task_id: string | null;
  topic: string | null;
  notes: string | null;
  course_name: string | null;
  course_color: string | null;
}

const mapSession = (r: SessionRow): StudySession => ({
  id: r.id,
  start: r.started_at,
  minutes: r.minutes,
  kind: r.kind,
  mode: r.mode,
  programmeId: r.programme_id,
  courseId: r.course_id,
  lectureId: r.lecture_id,
  taskId: r.task_id,
  topic: r.topic,
  notes: r.notes,
  courseName: r.course_name,
  courseColor: r.course_color,
});

export async function recordStudySession(input: StudySessionInput): Promise<void> {
  assertValid({
    start: isLocalDateTime(input.start) ? undefined : "Invalid start time.",
    minutes: Number.isInteger(input.minutes) && input.minutes > 0 && input.minutes <= 24 * 60 ? undefined : "Minutes must be between 1 and 1440.",
  });
  const db = await getDb();
  const now = nowIso();
  await db.execute(
    `INSERT INTO study_sessions (id, started_at, minutes, kind, mode, programme_id, course_id, lecture_id, task_id, topic, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
    [newId(), input.start, input.minutes, input.kind, input.mode, input.programmeId, input.courseId, input.lectureId, input.taskId, blankToNull(input.topic), blankToNull(input.notes), now],
  );
}

export async function listStudySessions(filter: { since?: DateKey; courseId?: string } = {}): Promise<StudySession[]> {
  const db = await getDb();
  const params: string[] = [];
  let sql = `SELECT s.*, c.name AS course_name, c.color AS course_color FROM study_sessions s
             LEFT JOIN courses c ON c.id = s.course_id AND c.deleted_at IS NULL WHERE s.deleted_at IS NULL`;
  if (filter.since) {
    params.push(`${filter.since}T00:00`);
    sql += ` AND s.started_at >= $${params.length}`;
  }
  if (filter.courseId) {
    params.push(filter.courseId);
    sql += ` AND s.course_id = $${params.length}`;
  }
  const rows = await db.select<SessionRow>(`${sql} ORDER BY s.started_at DESC`, params);
  return rows.map(mapSession);
}

export async function deleteStudySession(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE study_sessions SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}
