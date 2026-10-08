import { getDb } from "@/lib/db";
import { generateIcs, parseIcs, toWeeklyRule, type ExportEvent, type IcsEvent } from "@/domain/ics";
import { expandRule } from "@/domain/recurrence";
import { EVENT_TYPE_META, type EventType } from "@/domain/conflicts";
import { addDays, addMinutes, dateOf } from "@/domain/time";
import {
  cancelOccurrence,
  createEvent,
  createRecurring,
  listExceptions,
  listRecurring,
  moveOccurrence,
  updateEvent,
  updateRecurring,
  type RecurringType,
} from "./calendar";

export interface ImportOptions {
  /** Type given to imported items (e.g. "class" for a university timetable). */
  type: RecurringType;
  courseId: string | null;
}

export interface ImportPreview {
  total: number;
  recurring: number;
  single: number;
  overrides: number;
  cancelled: number;
  warnings: string[];
  firstDate: string | null;
  lastDate: string | null;
}

export function previewIcs(text: string): ImportPreview {
  const { events, warnings } = parseIcs(text);
  const live = events.filter((e) => !e.cancelled);
  const dates = live.map((e) => dateOf(e.start)).sort();
  return {
    total: events.length,
    recurring: live.filter((e) => !e.recurrenceId && e.rrule && toWeeklyRule(e).rule).length,
    single: live.filter((e) => !e.recurrenceId && !(e.rrule && toWeeklyRule(e).rule)).length,
    overrides: live.filter((e) => e.recurrenceId).length,
    cancelled: events.length - live.length,
    warnings,
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
  };
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

async function findByUid(table: "recurring_events" | "calendar_events", uid: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ id: string }>(`SELECT id FROM ${table} WHERE ics_uid = $1 AND deleted_at IS NULL LIMIT 1`, [uid]);
  return rows[0]?.id ?? null;
}

/**
 * Imports an .ics file. Weekly repeating events become recurring items, the
 * rest one-off events. Re-importing the same file updates what was imported
 * before (matched by UID) instead of duplicating it.
 */
export async function importIcs(text: string, opts: ImportOptions): Promise<ImportResult> {
  const { events, warnings } = parseIcs(text);
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, warnings: [...warnings] };
  const seriesByUid = new Map<string, string>();

  const masters = events.filter((e) => !e.recurrenceId);
  const overrides = events.filter((e) => e.recurrenceId);

  for (const e of masters) {
    if (e.cancelled) {
      result.skipped++;
      continue;
    }
    const conv = e.rrule ? toWeeklyRule(e) : null;
    if (conv?.rule) {
      const input = {
        type: opts.type,
        title: e.summary,
        courseId: opts.courseId,
        semesterId: null,
        location: e.location,
        lecturer: null,
        notes: e.description,
        ...conv.rule,
      };
      const existing = await findByUid("recurring_events", e.uid);
      const id = existing ? (await updateRecurring(existing, input)).id : (await createRecurring(input, e.uid)).id;
      result[existing ? "updated" : "created"]++;
      seriesByUid.set(e.uid, id);
      for (const x of e.exdates) await cancelOccurrence(id, x);
      // A weekly time given in UTC is a different local time on either side of a clock change.
      if (e.utc && crossesClockChange(conv.rule.startDate, conv.rule.endDate, conv.rule.startTime)) {
        result.warnings.push(`“${e.summary}”: this calendar gives times in UTC, so after the clocks change the class may show an hour off. Check it in the Timetable and adjust the time if needed.`);
      }
      continue;
    }
    if (conv && !conv.rule) result.warnings.push(`“${e.summary}”: ${conv.reason}; only the first occurrence was imported.`);
    await upsertSingle(e, opts.type, opts.courseId, result);
  }

  // Changed single occurrences of recurring events.
  for (const o of overrides) {
    const seriesId = seriesByUid.get(o.uid) ?? (await findByUid("recurring_events", o.uid));
    if (!seriesId) {
      await upsertSingle({ ...o, uid: `${o.uid}#${o.recurrenceId}` }, opts.type, opts.courseId, result);
      continue;
    }
    if (o.cancelled) await cancelOccurrence(seriesId, o.recurrenceId!);
    else await moveOccurrence(seriesId, o.recurrenceId!, o.start, o.end, o.location);
    result.updated++;
  }
  return result;
}

async function upsertSingle(e: IcsEvent, type: EventType, courseId: string | null, result: ImportResult) {
  const input = { type, title: e.summary, start: e.start, end: e.end, allDay: e.allDay, courseId, location: e.location, notes: e.description };
  const existing = await findByUid("calendar_events", e.uid);
  if (existing) await updateEvent(existing, input);
  else await createEvent(input, e.uid);
  result[existing ? "updated" : "created"]++;
}

/** Exports all calendar items (recurring rules with their exceptions, and events) as .ics text. */
export async function exportIcs(): Promise<string> {
  const db = await getDb();
  const out: ExportEvent[] = [];
  const category = (t: EventType) => EVENT_TYPE_META[t].label;

  for (const s of await listRecurring()) {
    const exceptions = await listExceptions(s.id);
    const changed = exceptions.filter((x) => x.action === "cancel" || x.action === "move").map((x) => x.originalDate);
    const first = expandRule(s, [], s.startDate, addDays(s.startDate, 14))[0];
    if (!first) continue;
    out.push({
      uid: s.icsUid ?? `${s.id}@studyos`,
      summary: s.title,
      location: s.location,
      description: s.notes,
      start: first.start,
      end: first.end,
      rule: s,
      exdates: [...new Set(changed)],
      categories: category(s.type),
    });
    for (const x of exceptions.filter((e) => e.action === "move" && e.newStart && e.newEnd)) {
      out.push({
        uid: `${s.id}-${x.originalDate}@studyos`,
        summary: s.title,
        location: x.location ?? s.location,
        start: x.newStart!,
        end: x.newEnd!,
        categories: category(s.type),
      });
    }
  }

  const events = await db.select<{ id: string; type: EventType; title: string; start_at: string; end_at: string; all_day: number; location: string | null; notes: string | null; ics_uid: string | null }>(
    "SELECT * FROM calendar_events WHERE deleted_at IS NULL ORDER BY start_at",
  );
  for (const e of events) {
    out.push({
      uid: e.ics_uid ?? `${e.id}@studyos`,
      summary: e.title,
      location: e.location,
      description: e.notes,
      start: e.start_at,
      end: e.end_at,
      allDay: e.all_day === 1,
      categories: category(e.type),
    });
  }
  // Exams and assignment deadlines.
  const exams = await db.select<{ id: string; title: string; start_at: string; duration_minutes: number | null; location: string | null; course: string }>(
    `SELECT e.id, e.title, e.start_at, e.duration_minutes, e.location, c.name AS course FROM exams e JOIN courses c ON c.id = e.course_id
     WHERE e.deleted_at IS NULL AND c.deleted_at IS NULL AND e.start_at IS NOT NULL`,
  );
  for (const e of exams) {
    out.push({ uid: `exam-${e.id}@studyos`, summary: `${e.title} (${e.course})`, location: e.location, start: e.start_at, end: addMinutes(e.start_at, e.duration_minutes ?? 120), categories: "Exam" });
  }
  const due = await db.select<{ id: string; title: string; due_at: string; course: string }>(
    `SELECT a.id, a.title, a.due_at, c.name AS course FROM assignments a JOIN courses c ON c.id = a.course_id
     WHERE a.deleted_at IS NULL AND c.deleted_at IS NULL AND a.due_at IS NOT NULL`,
  );
  for (const a of due) {
    out.push({ uid: `assignment-${a.id}@studyos`, summary: `Due: ${a.title} (${a.course})`, start: a.due_at, end: addMinutes(a.due_at, 30), categories: "Assignment" });
  }
  return generateIcs(out, { calendarName: "StudyOS" });
}

/** True if the local UTC offset differs between the first and last week of a series (default: one year). */
export function crossesClockChange(startDate: string, endDate: string | null, time: string): boolean {
  const at = (d: string) => new Date(`${d}T${time}:00`).getTimezoneOffset();
  const end = endDate ?? `${Number(startDate.slice(0, 4)) + 1}${startDate.slice(4)}`;
  if (at(startDate) !== at(end)) return true;
  // Check the middle too (a series could span both changes in a year).
  const mid = new Date((new Date(`${startDate}T12:00:00`).getTime() + new Date(`${end}T12:00:00`).getTime()) / 2);
  return mid.getTimezoneOffset() !== new Date(`${startDate}T12:00:00`).getTimezoneOffset();
}
