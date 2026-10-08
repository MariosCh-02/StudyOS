import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import { EVENT_TYPES, type EventType } from "@/domain/conflicts";
import { expandRule, type RuleException, type WeeklyRule } from "@/domain/recurrence";
import { addDays, addMinutes, dateOf, isLocalDateTime, isTime, type DateKey, type LocalDateTime } from "@/domain/time";
import { isDateKey } from "@/domain/dates";
import { assertValid, blankToNull, requireText } from "@/domain/validation";

export type RecurringType = Exclude<EventType, "assignment">;

export interface RecurringEvent extends WeeklyRule {
  id: string;
  type: RecurringType;
  title: string;
  courseId: string | null;
  semesterId: string | null;
  location: string | null;
  lecturer: string | null;
  notes: string | null;
  icsUid: string | null;
  createdAt: string;
  updatedAt: string;
}
export type RecurringInput = Omit<RecurringEvent, "id" | "icsUid" | "createdAt" | "updatedAt">;

export interface CalendarEvent {
  id: string;
  type: EventType;
  title: string;
  start: LocalDateTime;
  end: LocalDateTime;
  allDay: boolean;
  courseId: string | null;
  location: string | null;
  notes: string | null;
  icsUid: string | null;
  createdAt: string;
  updatedAt: string;
}
export type CalendarEventInput = Omit<CalendarEvent, "id" | "icsUid" | "createdAt" | "updatedAt">;

/** Anything shown on the calendar: a one-off event or one occurrence of a recurring item. */
export interface CalendarItem {
  /** Unique per item: the event id, or `${seriesId}@${originalDate}`. */
  key: string;
  /** Where the item comes from; assignments, exams and project dates are shown read-only. */
  source: "event" | "series" | "assignment" | "exam" | "project" | "milestone";
  /** Event, series, assignment or exam id; the project id for project and milestone items. */
  id: string;
  originalDate: DateKey | null;
  type: EventType;
  title: string;
  start: LocalDateTime;
  end: LocalDateTime;
  allDay: boolean;
  location: string | null;
  lecturer: string | null;
  notes: string | null;
  courseId: string | null;
  courseCode: string | null;
  courseColor: string | null;
  moved: boolean;
}

// ------------------------------------------------------------- mapping

interface SeriesRow {
  id: string;
  type: RecurringType;
  title: string;
  course_id: string | null;
  semester_id: string | null;
  weekdays: string;
  start_time: string;
  end_time: string;
  start_date: string;
  end_date: string | null;
  interval_weeks: number;
  location: string | null;
  lecturer: string | null;
  notes: string | null;
  ics_uid: string | null;
  created_at: string;
  updated_at: string;
}

function parseWeekdays(json: string): number[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.map(Number).filter((d) => d >= 1 && d <= 7) : [];
  } catch {
    return [];
  }
}

const mapSeries = (r: SeriesRow): RecurringEvent => ({
  id: r.id,
  type: r.type,
  title: r.title,
  courseId: r.course_id,
  semesterId: r.semester_id,
  weekdays: parseWeekdays(r.weekdays),
  startTime: r.start_time,
  endTime: r.end_time,
  startDate: r.start_date,
  endDate: r.end_date,
  intervalWeeks: r.interval_weeks,
  location: r.location,
  lecturer: r.lecturer,
  notes: r.notes,
  icsUid: r.ics_uid,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

interface EventRow {
  id: string;
  type: EventType;
  title: string;
  start_at: string;
  end_at: string;
  all_day: number;
  course_id: string | null;
  location: string | null;
  notes: string | null;
  ics_uid: string | null;
  created_at: string;
  updated_at: string;
}

const mapEvent = (r: EventRow): CalendarEvent => ({
  id: r.id,
  type: r.type,
  title: r.title,
  start: r.start_at,
  end: r.end_at,
  allDay: r.all_day === 1,
  courseId: r.course_id,
  location: r.location,
  notes: r.notes,
  icsUid: r.ics_uid,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// ---------------------------------------------------------- validation

function validateRecurring(input: RecurringInput): RecurringInput {
  const weekdays = [...new Set(input.weekdays)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort();
  assertValid({
    title: requireText(input.title, "Title"),
    type: (EVENT_TYPES as readonly string[]).includes(input.type) && input.type !== ("assignment" as string) ? undefined : "Choose a type.",
    weekdays: weekdays.length ? undefined : "Choose at least one day.",
    startTime: isTime(input.startTime) ? undefined : "Start time must be HH:MM.",
    endTime: !isTime(input.endTime) ? "End time must be HH:MM." : input.endTime === input.startTime ? "End time must differ from start time." : undefined,
    startDate: isDateKey(input.startDate) ? undefined : "Choose the first date.",
    endDate:
      input.endDate && !isDateKey(input.endDate)
        ? "End date must be a valid date."
        : input.endDate && input.endDate < input.startDate
          ? "End date must be on or after the first date."
          : undefined,
    intervalWeeks: Number.isInteger(input.intervalWeeks) && input.intervalWeeks >= 1 && input.intervalWeeks <= 8 ? undefined : "Repeat every 1–8 weeks.",
  });
  return {
    ...input,
    weekdays,
    title: input.title.trim(),
    endDate: blankToNull(input.endDate),
    location: blankToNull(input.location),
    lecturer: blankToNull(input.lecturer),
    notes: blankToNull(input.notes),
    courseId: input.courseId || null,
    semesterId: input.semesterId || null,
  };
}

function validateEvent(input: CalendarEventInput): CalendarEventInput {
  assertValid({
    title: requireText(input.title, "Title"),
    type: (EVENT_TYPES as readonly string[]).includes(input.type) ? undefined : "Choose a type.",
    start: isLocalDateTime(input.start) ? undefined : "Choose a valid start.",
    end: !isLocalDateTime(input.end) ? "Choose a valid end." : input.end <= input.start ? "End must be after the start." : undefined,
  });
  return {
    ...input,
    title: input.title.trim(),
    location: blankToNull(input.location),
    notes: blankToNull(input.notes),
    courseId: input.courseId || null,
  };
}

// ------------------------------------------------------- recurring CRUD

export async function listRecurring(filter: { type?: RecurringType; courseId?: string } = {}): Promise<RecurringEvent[]> {
  const db = await getDb();
  const clauses = ["deleted_at IS NULL"];
  const params: string[] = [];
  if (filter.type) {
    params.push(filter.type);
    clauses.push(`type = $${params.length}`);
  }
  if (filter.courseId) {
    params.push(filter.courseId);
    clauses.push(`course_id = $${params.length}`);
  }
  const rows = await db.select<SeriesRow>(
    `SELECT * FROM recurring_events WHERE ${clauses.join(" AND ")} ORDER BY type, start_time, title COLLATE NOCASE`,
    params,
  );
  return rows.map(mapSeries);
}

export async function getRecurring(id: string): Promise<RecurringEvent | null> {
  const db = await getDb();
  const rows = await db.select<SeriesRow>("SELECT * FROM recurring_events WHERE id = $1 AND deleted_at IS NULL", [id]);
  return rows[0] ? mapSeries(rows[0]) : null;
}

export async function createRecurring(input: RecurringInput, icsUid: string | null = null): Promise<RecurringEvent> {
  const v = validateRecurring(input);
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO recurring_events (id, type, title, course_id, semester_id, weekdays, start_time, end_time, start_date, end_date,
       interval_weeks, location, lecturer, notes, ics_uid, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)`,
    [id, v.type, v.title, v.courseId, v.semesterId, JSON.stringify(v.weekdays), v.startTime, v.endTime, v.startDate, v.endDate,
      v.intervalWeeks, v.location, v.lecturer, v.notes, icsUid, now],
  );
  return (await getRecurring(id))!;
}

export async function updateRecurring(id: string, input: RecurringInput): Promise<RecurringEvent> {
  const v = validateRecurring(input);
  const db = await getDb();
  await db.execute(
    `UPDATE recurring_events SET type = $2, title = $3, course_id = $4, semester_id = $5, weekdays = $6, start_time = $7, end_time = $8,
       start_date = $9, end_date = $10, interval_weeks = $11, location = $12, lecturer = $13, notes = $14, updated_at = $15
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, v.type, v.title, v.courseId, v.semesterId, JSON.stringify(v.weekdays), v.startTime, v.endTime, v.startDate, v.endDate,
      v.intervalWeeks, v.location, v.lecturer, v.notes, nowIso()],
  );
  const s = await getRecurring(id);
  if (!s) throw new Error("Recurring item not found.");
  return s;
}

export async function deleteRecurring(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE recurrence_exceptions SET deleted_at = $2, updated_at = $2 WHERE series_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE recurring_events SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

/** Ends a recurring item before `date`, keeping its past occurrences. */
export async function endRecurringBefore(id: string, date: DateKey): Promise<void> {
  const s = await getRecurring(id);
  if (!s) throw new Error("Recurring item not found.");
  if (date <= s.startDate) return deleteRecurring(id);
  const db = await getDb();
  await db.execute("UPDATE recurring_events SET end_date = $2, updated_at = $3 WHERE id = $1", [id, addDays(date, -1), nowIso()]);
}

// ----------------------------------------------------------- exceptions

interface ExceptionRow {
  series_id: string;
  original_date: string;
  action: "cancel" | "move";
  new_start: string | null;
  new_end: string | null;
  location: string | null;
  updated_at: string;
}

async function clearExceptions(seriesId: string, originalDate: DateKey, now: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE recurrence_exceptions SET deleted_at = $3, updated_at = $3 WHERE series_id = $1 AND original_date = $2 AND deleted_at IS NULL",
    [seriesId, originalDate, now],
  );
}

async function addException(seriesId: string, originalDate: DateKey, action: "cancel" | "move", newStart: string | null, newEnd: string | null, location: string | null) {
  const db = await getDb();
  const now = nowIso();
  await clearExceptions(seriesId, originalDate, now);
  await db.execute(
    `INSERT INTO recurrence_exceptions (id, series_id, original_date, action, new_start, new_end, location, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [newId(), seriesId, originalDate, action, newStart, newEnd, location, now],
  );
}

/** Skips one occurrence (e.g. a cancelled class or a day off work). */
export const cancelOccurrence = (seriesId: string, originalDate: DateKey) => addException(seriesId, originalDate, "cancel", null, null, null);

/** Moves one occurrence to a different time (and optionally room). */
export async function moveOccurrence(seriesId: string, originalDate: DateKey, start: LocalDateTime, end: LocalDateTime, location: string | null = null): Promise<void> {
  assertValid({
    start: isLocalDateTime(start) ? undefined : "Choose a valid start.",
    end: !isLocalDateTime(end) ? "Choose a valid end." : end <= start ? "End must be after the start." : undefined,
  });
  await addException(seriesId, originalDate, "move", start, end, blankToNull(location));
}

/** Undoes a cancellation or move. */
export const restoreOccurrence = (seriesId: string, originalDate: DateKey) => clearExceptions(seriesId, originalDate, nowIso());

export async function listExceptions(seriesId: string): Promise<RuleException[]> {
  const db = await getDb();
  const rows = await db.select<ExceptionRow>(
    "SELECT * FROM recurrence_exceptions WHERE series_id = $1 AND deleted_at IS NULL ORDER BY original_date",
    [seriesId],
  );
  return rows.map((r) => ({ originalDate: r.original_date, action: r.action, newStart: r.new_start, newEnd: r.new_end, location: r.location, updatedAt: r.updated_at }));
}

// --------------------------------------------------------- one-off events

export async function getEvent(id: string): Promise<CalendarEvent | null> {
  const db = await getDb();
  const rows = await db.select<EventRow>("SELECT * FROM calendar_events WHERE id = $1 AND deleted_at IS NULL", [id]);
  return rows[0] ? mapEvent(rows[0]) : null;
}

export async function createEvent(input: CalendarEventInput, icsUid: string | null = null): Promise<CalendarEvent> {
  const v = validateEvent(input);
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO calendar_events (id, type, title, start_at, end_at, all_day, course_id, location, notes, ics_uid, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
    [id, v.type, v.title, v.start, v.end, v.allDay ? 1 : 0, v.courseId, v.location, v.notes, icsUid, now],
  );
  return (await getEvent(id))!;
}

export async function updateEvent(id: string, input: CalendarEventInput): Promise<CalendarEvent> {
  const v = validateEvent(input);
  const db = await getDb();
  await db.execute(
    `UPDATE calendar_events SET type = $2, title = $3, start_at = $4, end_at = $5, all_day = $6, course_id = $7, location = $8, notes = $9, updated_at = $10
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, v.type, v.title, v.start, v.end, v.allDay ? 1 : 0, v.courseId, v.location, v.notes, nowIso()],
  );
  const e = await getEvent(id);
  if (!e) throw new Error("Event not found.");
  return e;
}

export async function deleteEvent(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE calendar_events SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

// --------------------------------------------------------------- agenda

interface CourseInfo {
  id: string;
  code: string | null;
  color: string | null;
  deleted: boolean;
}

/**
 * Everything on the calendar whose start falls between `from` and `to`
 * (inclusive dates), plus multi-day events that overlap the range,
 * sorted by start. Items of deleted courses are hidden.
 */
export async function getCalendarItems(from: DateKey, to: DateKey): Promise<CalendarItem[]> {
  const db = await getDb();
  const rangeStart = `${from}T00:00`;
  const rangeEnd = `${addDays(to, 1)}T00:00`;
  const [seriesRows, exceptionRows, eventRows, courseRows, assignmentRows, examRows, projectRows, milestoneRows] = await Promise.all([
    db.select<SeriesRow>("SELECT * FROM recurring_events WHERE deleted_at IS NULL"),
    db.select<ExceptionRow>(
      `SELECT x.* FROM recurrence_exceptions x JOIN recurring_events s ON s.id = x.series_id
       WHERE x.deleted_at IS NULL AND s.deleted_at IS NULL`,
    ),
    db.select<EventRow>("SELECT * FROM calendar_events WHERE deleted_at IS NULL AND start_at < $2 AND end_at > $1 ORDER BY start_at", [rangeStart, rangeEnd]),
    db.select<{ id: string; code: string | null; color: string | null; deleted_at: string | null }>("SELECT id, code, color, deleted_at FROM courses"),
    db.select<{ id: string; course_id: string; title: string; due_at: string; status: string; notes: string | null }>(
      "SELECT id, course_id, title, due_at, status, notes FROM assignments WHERE deleted_at IS NULL AND due_at >= $1 AND due_at < $2",
      [rangeStart, rangeEnd],
    ),
    db.select<{ id: string; course_id: string; title: string; start_at: string; duration_minutes: number | null; location: string | null; notes: string | null }>(
      "SELECT id, course_id, title, start_at, duration_minutes, location, notes FROM exams WHERE deleted_at IS NULL AND start_at >= $1 AND start_at < $2",
      [rangeStart, rangeEnd],
    ),
    db.select<{ id: string; course_id: string | null; title: string; due_date: string; status: string }>(
      "SELECT id, course_id, title, due_date, status FROM projects WHERE deleted_at IS NULL AND status != 'cancelled' AND due_date >= $1 AND due_date <= $2",
      [from, to],
    ),
    db.select<{ id: string; project_id: string; course_id: string | null; title: string; project_title: string; due_date: string; done_at: string | null }>(
      `SELECT m.id, m.project_id, p.course_id, m.title, p.title AS project_title, m.due_date, m.done_at FROM project_milestones m
       JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL AND p.status != 'cancelled'
       WHERE m.deleted_at IS NULL AND m.due_date >= $1 AND m.due_date <= $2`,
      [from, to],
    ),
  ]);

  const courses = new Map<string, CourseInfo>(courseRows.map((c) => [c.id, { id: c.id, code: c.code, color: c.color, deleted: c.deleted_at != null }]));
  const hidden = (courseId: string | null) => courseId != null && courses.get(courseId)?.deleted === true;

  const exceptionsBySeries = new Map<string, RuleException[]>();
  for (const x of exceptionRows) {
    const list = exceptionsBySeries.get(x.series_id) ?? [];
    list.push({ originalDate: x.original_date, action: x.action, newStart: x.new_start, newEnd: x.new_end, location: x.location, updatedAt: x.updated_at });
    exceptionsBySeries.set(x.series_id, list);
  }

  const items: CalendarItem[] = [];
  for (const row of seriesRows) {
    const s = mapSeries(row);
    if (hidden(s.courseId)) continue;
    const course = s.courseId ? courses.get(s.courseId) : undefined;
    for (const o of expandRule(s, exceptionsBySeries.get(s.id) ?? [], from, to)) {
      items.push({
        key: `${s.id}@${o.originalDate}`,
        source: "series",
        id: s.id,
        originalDate: o.originalDate,
        type: s.type,
        title: s.title,
        start: o.start,
        end: o.end,
        allDay: false,
        location: o.locationOverride ?? s.location,
        lecturer: s.lecturer,
        notes: s.notes,
        courseId: s.courseId,
        courseCode: course?.code ?? null,
        courseColor: course?.color ?? null,
        moved: o.moved,
      });
    }
  }
  for (const row of eventRows) {
    const e = mapEvent(row);
    if (hidden(e.courseId)) continue;
    const course = e.courseId ? courses.get(e.courseId) : undefined;
    items.push({
      key: e.id,
      source: "event",
      id: e.id,
      originalDate: null,
      type: e.type,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      location: e.location,
      lecturer: null,
      notes: e.notes,
      courseId: e.courseId,
      courseCode: course?.code ?? null,
      courseColor: course?.color ?? null,
      moved: false,
    });
  }
  // Deadlines and exams appear automatically.
  for (const a of assignmentRows) {
    if (hidden(a.course_id)) continue;
    const course = courses.get(a.course_id);
    items.push({
      key: `assignment:${a.id}`,
      source: "assignment",
      id: a.id,
      originalDate: null,
      type: "assignment",
      title: `Due: ${a.title}${a.status === "submitted" || a.status === "graded" ? " ✓" : ""}`,
      start: a.due_at,
      end: addMinutes(a.due_at, 30),
      allDay: false,
      location: null,
      lecturer: null,
      notes: a.notes,
      courseId: a.course_id,
      courseCode: course?.code ?? null,
      courseColor: course?.color ?? null,
      moved: false,
    });
  }
  for (const e of examRows) {
    if (hidden(e.course_id)) continue;
    const course = courses.get(e.course_id);
    items.push({
      key: `exam:${e.id}`,
      source: "exam",
      id: e.id,
      originalDate: null,
      type: "exam",
      title: e.title,
      start: e.start_at,
      end: addMinutes(e.start_at, e.duration_minutes ?? 120),
      allDay: false,
      location: e.location,
      lecturer: null,
      notes: e.notes,
      courseId: e.course_id,
      courseCode: course?.code ?? null,
      courseColor: course?.color ?? null,
      moved: false,
    });
  }
  // Project deadlines and milestones are all-day markers.
  const projectItem = (source: "project" | "milestone", key: string, projectId: string, courseId: string | null, title: string, date: DateKey, type: EventType, notes: string | null): CalendarItem => {
    const course = courseId ? courses.get(courseId) : undefined;
    return {
      key,
      source,
      id: projectId,
      originalDate: null,
      type,
      title,
      start: `${date}T00:00`,
      end: `${addDays(date, 1)}T00:00`,
      allDay: true,
      location: null,
      lecturer: null,
      notes,
      courseId,
      courseCode: course?.code ?? null,
      courseColor: course?.color ?? null,
      moved: false,
    };
  };
  for (const p of projectRows) {
    if (hidden(p.course_id)) continue;
    items.push(projectItem("project", `project:${p.id}`, p.id, p.course_id, `Project due: ${p.title}${p.status === "completed" ? " ✓" : ""}`, p.due_date, "assignment", null));
  }
  for (const m of milestoneRows) {
    if (hidden(m.course_id)) continue;
    items.push(projectItem("milestone", `milestone:${m.id}`, m.project_id, m.course_id, `${m.title}${m.done_at ? " ✓" : ""}`, m.due_date, "research", `Milestone of ${m.project_title}`));
  }
  return items.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

/** Items on a single day (including ones that started the day before and run into it). */
export async function getDayItems(date: DateKey): Promise<CalendarItem[]> {
  const items = await getCalendarItems(addDays(date, -1), date);
  return items.filter((i) => dateOf(i.start) === date || (i.end > `${date}T00:00` && dateOf(i.start) < date));
}
