/**
 * Study time, attendance and deadline helpers.
 */
import { absMinutes, addDays, dateOf, diffMinutes, startOfWeek, type DateKey, type LocalDateTime } from "./time";

// ------------------------------------------------------------ study time

export interface SessionLike {
  start: LocalDateTime;
  minutes: number;
  courseId: string | null;
}

export interface StudyTotals {
  today: number;
  week: number;
  month: number;
  total: number;
  /** Consecutive days up to today (or yesterday) with any study. */
  streak: number;
  /** Distinct study days in the last 14 days. */
  activeDays14: number;
}

export function studyTotals(sessions: SessionLike[], now: LocalDateTime, weekStart: 1 | 7 = 1): StudyTotals {
  const today = dateOf(now);
  const week = startOfWeek(today, weekStart);
  const month = `${today.slice(0, 7)}-01`;
  const days = new Set<DateKey>();
  const t: StudyTotals = { today: 0, week: 0, month: 0, total: 0, streak: 0, activeDays14: 0 };
  for (const s of sessions) {
    const d = dateOf(s.start);
    if (d > today) continue;
    t.total += s.minutes;
    if (d === today) t.today += s.minutes;
    if (d >= week) t.week += s.minutes;
    if (d >= month) t.month += s.minutes;
    if (s.minutes > 0) days.add(d);
  }
  let cursor = days.has(today) ? today : addDays(today, -1);
  while (days.has(cursor)) {
    t.streak++;
    cursor = addDays(cursor, -1);
  }
  for (let i = 0; i < 14; i++) if (days.has(addDays(today, -i))) t.activeDays14++;
  return t;
}

export function minutesByCourse(sessions: SessionLike[]): Map<string | null, number> {
  const m = new Map<string | null, number>();
  for (const s of sessions) m.set(s.courseId, (m.get(s.courseId) ?? 0) + s.minutes);
  return m;
}

// ------------------------------------------------------------ attendance

export type AttendanceStatus = "present" | "late" | "absent" | "excused";

export interface AttendanceStats {
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Past scheduled classes with nothing recorded. */
  unmarked: number;
  /** (present + late) / (present + late + absent); null if nothing counts yet. */
  rate: number | null;
}

/**
 * Combines recorded attendance (latest record per date wins) with the dates
 * classes were scheduled, so unrecorded past classes are visible.
 */
export function attendanceStats(records: { date: DateKey; status: AttendanceStatus; updatedAt: string }[], scheduledPast: DateKey[]): AttendanceStats {
  const latest = new Map<DateKey, { status: AttendanceStatus; updatedAt: string }>();
  for (const r of records) {
    const prev = latest.get(r.date);
    if (!prev || r.updatedAt > prev.updatedAt) latest.set(r.date, r);
  }
  const s: AttendanceStats = { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0, rate: null };
  for (const { status } of latest.values()) s[status]++;
  s.unmarked = [...new Set(scheduledPast)].filter((d) => !latest.has(d)).length;
  const counted = s.present + s.late + s.absent;
  s.rate = counted > 0 ? (s.present + s.late) / counted : null;
  return s;
}

// ------------------------------------------------------------- deadlines

export interface Deadline {
  key: string;
  title: string;
  due: LocalDateTime;
}

/** Pairs of deadlines due within `windowHours` of each other. */
export function deadlineClashes<T extends Deadline>(deadlines: T[], windowHours = 24): [T, T][] {
  const sorted = [...deadlines].sort((a, b) => a.due.localeCompare(b.due));
  const out: [T, T][] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (diffMinutes(sorted[i]!.due, sorted[j]!.due) > windowHours * 60) break;
      out.push([sorted[i]!, sorted[j]!]);
    }
  }
  return out;
}

/** Whole days from `now` until `when` (0 = today, negative = past). */
export function daysUntil(when: LocalDateTime | DateKey, now: LocalDateTime): number {
  const target = when.length === 10 ? `${when}T00:00` : when;
  return Math.floor(absMinutes(`${dateOf(target)}T00:00`) / 1440) - Math.floor(absMinutes(`${dateOf(now)}T00:00`) / 1440);
}

export function describeDue(when: LocalDateTime, now: LocalDateTime): string {
  const days = daysUntil(when, now);
  if (when < now) return days === 0 ? "overdue (today)" : `overdue by ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
}
