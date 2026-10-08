/**
 * Smart study planner: proposes revision sessions before an exam, placed in
 * free time and weighted towards weaker topics.
 */
import { freeSlots, type TimedItem } from "./conflicts";
import { absMinutes, addDays, dateOf, fromAbsMinutes, type DateKey, type LocalDateTime, type TimeOfDay } from "./time";

export interface PlanTopic {
  name: string;
  /** Higher = needs more revision (e.g. 3 for "not reviewed", 1 for "reviewed"). */
  weight: number;
}

export interface PlanOptions {
  topics: PlanTopic[];
  /** First day to schedule (usually tomorrow). */
  from: DateKey;
  /** Exam date; nothing is scheduled on or after it. */
  examDate: DateKey;
  busy: TimedItem[];
  sessionMinutes: number;
  maxSessionsPerDay: number;
  dayStart?: TimeOfDay;
  dayEnd?: TimeOfDay;
}

export interface PlannedSession {
  topic: string;
  start: LocalDateTime;
  end: LocalDateTime;
}

/**
 * Allocates sessions to topics in proportion to their weight (largest
 * remainder), then places them day by day in the earliest free slots, with
 * a 15-minute buffer around existing commitments. The last day before the
 * exam is reserved for a full review when there are several topics.
 */
export function planRevision(o: PlanOptions): PlannedSession[] {
  const topics = o.topics.filter((t) => t.name.trim() && t.weight > 0);
  if (!topics.length || o.from >= o.examDate || o.sessionMinutes < 15) return [];

  // 1. Capacity: free slots per day.
  const buffer = 15;
  const padded = o.busy.map((b) => ({ ...b, start: fromAbsMinutes(absMinutes(b.start) - buffer), end: fromAbsMinutes(absMinutes(b.end) + buffer) }));
  const days: { date: DateKey; slots: LocalDateTime[] }[] = [];
  for (let d = o.from; d < o.examDate; d = addDays(d, 1)) {
    const starts: LocalDateTime[] = [];
    for (const gap of freeSlots(padded, d, o.sessionMinutes, o.dayStart ?? "09:00", o.dayEnd ?? "21:00")) {
      for (let t = absMinutes(gap.start); t + o.sessionMinutes <= absMinutes(gap.end) && starts.length < o.maxSessionsPerDay; t += o.sessionMinutes + buffer) {
        starts.push(fromAbsMinutes(t));
      }
      if (starts.length >= o.maxSessionsPerDay) break;
    }
    days.push({ date: d, slots: starts });
  }
  const capacity = days.reduce((n, d) => n + d.slots.length, 0);
  if (!capacity) return [];

  // 2. Reserve the final day's first slot for a mixed review.
  const reviewDay = topics.length > 1 && days.length > 1 ? days[days.length - 1]! : null;
  const reviewSlot = reviewDay?.slots.length ? reviewDay.slots.shift()! : null;
  const available = capacity - (reviewSlot ? 1 : 0);

  // 3. Sessions per topic, proportional to weight (at least one each while capacity lasts).
  const totalWeight = topics.reduce((s, t) => s + t.weight, 0);
  // With room for every topic, each gets one session first; the rest is split by weight.
  const base = available >= topics.length ? 1 : 0;
  const spread = available - base * topics.length;
  const raw = topics.map((t) => (totalWeight > 0 ? t.weight / totalWeight : 1 / topics.length) * spread);
  const counts = raw.map((r) => base + Math.floor(r));
  let left = available - counts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    counts[i]!++;
    left--;
  }

  // 4. Interleave topics (weakest first) so each day mixes subjects.
  const queue: string[] = [];
  const remaining = topics.map((t, i) => ({ name: t.name, n: counts[i]!, w: t.weight })).sort((a, b) => b.w - a.w);
  while (remaining.some((r) => r.n > 0)) {
    for (const r of remaining) {
      if (r.n > 0) {
        queue.push(r.name);
        r.n--;
      }
    }
  }

  const out: PlannedSession[] = [];
  for (const day of days) {
    for (const start of day.slots) {
      const topic = queue.shift();
      if (!topic) break;
      out.push({ topic, start, end: fromAbsMinutes(absMinutes(start) + o.sessionMinutes) });
    }
  }
  if (reviewSlot) out.push({ topic: "Full review", start: reviewSlot, end: fromAbsMinutes(absMinutes(reviewSlot) + o.sessionMinutes) });
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export const sessionsByDay = (sessions: PlannedSession[]) =>
  sessions.reduce<Map<DateKey, PlannedSession[]>>((m, s) => m.set(dateOf(s.start), [...(m.get(dateOf(s.start)) ?? []), s]), new Map());
