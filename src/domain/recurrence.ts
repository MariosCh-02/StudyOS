/**
 * Weekly recurrence rules and their expansion into concrete occurrences.
 */
import {
  addDays,
  dayNumber,
  isoWeekday,
  joinDateTime,
  startOfWeek,
  timeToMinutes,
  addMinutes,
  dateOf,
  type DateKey,
  type LocalDateTime,
  type TimeOfDay,
} from "./time";

export interface WeeklyRule {
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  startTime: TimeOfDay;
  /** If not after startTime, the occurrence ends on the following day. */
  endTime: TimeOfDay;
  startDate: DateKey;
  endDate: DateKey | null;
  intervalWeeks: number;
}

export interface RuleException {
  originalDate: DateKey;
  action: "cancel" | "move";
  newStart: LocalDateTime | null;
  newEnd: LocalDateTime | null;
  location: string | null;
  updatedAt: string;
}

export interface Occurrence {
  originalDate: DateKey;
  start: LocalDateTime;
  end: LocalDateTime;
  moved: boolean;
  locationOverride: string | null;
}

/** Length of one occurrence in minutes (overnight rules wrap to the next day). */
export function ruleDuration(rule: Pick<WeeklyRule, "startTime" | "endTime">): number {
  const d = timeToMinutes(rule.endTime) - timeToMinutes(rule.startTime);
  return d > 0 ? d : d + 1440;
}

/** Whether the rule produces an occurrence on `date` (ignoring exceptions). */
export function occursOn(rule: WeeklyRule, date: DateKey): boolean {
  if (date < rule.startDate || (rule.endDate && date > rule.endDate)) return false;
  if (!rule.weekdays.includes(isoWeekday(date))) return false;
  if (rule.intervalWeeks <= 1) return true;
  const weeks = (dayNumber(startOfWeek(date)) - dayNumber(startOfWeek(rule.startDate))) / 7;
  return weeks % rule.intervalWeeks === 0;
}

/** Latest exception per original date (devices may record duplicates). */
function latestExceptions(exceptions: RuleException[]): Map<DateKey, RuleException> {
  const map = new Map<DateKey, RuleException>();
  for (const e of exceptions) {
    const prev = map.get(e.originalDate);
    if (!prev || e.updatedAt > prev.updatedAt) map.set(e.originalDate, e);
  }
  return map;
}

function occurrenceAt(rule: WeeklyRule, date: DateKey): Occurrence {
  const start = joinDateTime(date, rule.startTime);
  return { originalDate: date, start, end: addMinutes(start, ruleDuration(rule)), moved: false, locationOverride: null };
}

/**
 * Occurrences whose start falls within [from, to] (inclusive dates), after
 * applying cancellations and moves.
 */
export function expandRule(rule: WeeklyRule, exceptions: RuleException[], from: DateKey, to: DateKey): Occurrence[] {
  const byDate = latestExceptions(exceptions);
  const out: Occurrence[] = [];

  const first = from > rule.startDate ? from : rule.startDate;
  const last = rule.endDate && rule.endDate < to ? rule.endDate : to;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    if (!occursOn(rule, d)) continue;
    if (byDate.has(d)) continue; // cancelled, or moved (handled below)
    out.push(occurrenceAt(rule, d));
  }

  // Moved occurrences appear at their new time, wherever the original was.
  for (const e of byDate.values()) {
    if (e.action !== "move" || !e.newStart || !e.newEnd) continue;
    if (!occursOn(rule, e.originalDate)) continue;
    const day = dateOf(e.newStart);
    if (day < from || day > to) continue;
    out.push({ originalDate: e.originalDate, start: e.newStart, end: e.newEnd, moved: true, locationOverride: e.location });
  }

  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** Number of occurrences before exceptions (used for ICS COUNT and summaries). */
export function countOccurrences(rule: WeeklyRule, limitDate: DateKey): number {
  let n = 0;
  const last = rule.endDate && rule.endDate < limitDate ? rule.endDate : limitDate;
  for (let d = rule.startDate; d <= last; d = addDays(d, 1)) if (occursOn(rule, d)) n++;
  return n;
}

/** Date of the `count`-th occurrence, for converting ICS COUNT to an end date. */
export function dateOfNthOccurrence(rule: Omit<WeeklyRule, "endDate">, count: number, maxDays = 3660): DateKey | null {
  let n = 0;
  const r = { ...rule, endDate: null };
  for (let i = 0, d = rule.startDate; i < maxDays; i++, d = addDays(d, 1)) {
    if (occursOn(r, d) && ++n === count) return d;
  }
  return null;
}
