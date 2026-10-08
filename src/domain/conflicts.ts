/**
 * Schedule conflict detection and free-slot suggestions.
 */
import { absMinutes, addDays, dateOf, fromAbsMinutes, joinDateTime, type DateKey, type LocalDateTime, type TimeOfDay } from "./time";

export const EVENT_TYPES = ["class", "work", "study", "assignment", "exam", "internship", "research", "personal", "other"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_META: Record<EventType, { label: string; emoji: string; color: string }> = {
  class: { label: "Class", emoji: "🎓", color: "#7b8ff7" },
  work: { label: "Work", emoji: "💼", color: "#94a3b8" },
  study: { label: "Study", emoji: "🧠", color: "#4cc790" },
  assignment: { label: "Assignment", emoji: "📝", color: "#e0b05c" },
  exam: { label: "Exam", emoji: "📚", color: "#f0717a" },
  internship: { label: "Internship", emoji: "🔬", color: "#5bc0de" },
  research: { label: "Research", emoji: "🔬", color: "#c084fc" },
  personal: { label: "Personal", emoji: "📌", color: "#f472b6" },
  other: { label: "Other", emoji: "•", color: "#a0a6b1" },
};

export interface TimedItem {
  /** Unique per occurrence (recurring items share an id but not a key). */
  key: string;
  type: EventType;
  title: string;
  start: LocalDateTime;
  end: LocalDateTime;
  allDay: boolean;
}

export interface Conflict<T extends TimedItem = TimedItem> {
  a: T;
  b: T;
  /** Overlap in minutes. */
  overlap: number;
}

/** Commitments that need you somewhere at a fixed time. */
const FIXED: ReadonlySet<EventType> = new Set(["class", "work", "exam", "internship"]);
/** Plans you could move. */
const FLEXIBLE: ReadonlySet<EventType> = new Set(["study", "research", "personal", "other"]);

/**
 * Two overlapping items conflict when at least one is a fixed commitment
 * (class vs work, class vs study, exam vs work, …). Overlaps between two
 * flexible plans are left alone, as are all-day items and deadlines.
 */
export function isConflictingPair(a: EventType, b: EventType): boolean {
  if (a === "assignment" || b === "assignment") return false;
  return FIXED.has(a) || FIXED.has(b);
}

export const isFlexible = (t: EventType): boolean => FLEXIBLE.has(t);

export function findConflicts<T extends TimedItem>(items: T[]): Conflict<T>[] {
  const timed = items.filter((i) => !i.allDay && i.end > i.start).sort((x, y) => x.start.localeCompare(y.start));
  const out: Conflict<T>[] = [];
  for (let i = 0; i < timed.length; i++) {
    const a = timed[i]!;
    for (let j = i + 1; j < timed.length; j++) {
      const b = timed[j]!;
      if (b.start >= a.end) break; // sorted by start: nothing later overlaps a
      if (!isConflictingPair(a.type, b.type)) continue;
      const overlap = Math.min(absMinutes(a.end), absMinutes(b.end)) - absMinutes(b.start);
      if (overlap > 0) out.push({ a, b, overlap });
    }
  }
  return out;
}

export interface Slot {
  start: LocalDateTime;
  end: LocalDateTime;
}

/** Free gaps of at least `minutes` on `date` between dayStart and dayEnd. */
export function freeSlots(items: TimedItem[], date: DateKey, minutes: number, dayStart: TimeOfDay = "08:00", dayEnd: TimeOfDay = "22:00"): Slot[] {
  const startBound = absMinutes(joinDateTime(date, dayStart));
  const endBound = absMinutes(joinDateTime(date, dayEnd));
  const busy = items
    .filter((i) => !i.allDay && absMinutes(i.end) > startBound && absMinutes(i.start) < endBound)
    .map((i) => [Math.max(absMinutes(i.start), startBound), Math.min(absMinutes(i.end), endBound)] as const)
    .sort((x, y) => x[0] - y[0]);
  const slots: Slot[] = [];
  let cursor = startBound;
  for (const [s, e] of busy) {
    if (s - cursor >= minutes) slots.push({ start: fromAbsMinutes(cursor), end: fromAbsMinutes(s) });
    cursor = Math.max(cursor, e);
  }
  if (endBound - cursor >= minutes) slots.push({ start: fromAbsMinutes(cursor), end: fromAbsMinutes(endBound) });
  return slots;
}

/**
 * Alternative times for the movable side of a conflict: the earliest free
 * gaps of the same length, today and over the following days.
 * Returns an empty list when both sides are fixed commitments.
 */
export function suggestAlternatives<T extends TimedItem>(conflict: Conflict<T>, allItems: T[], days = 7, max = 3): { item: T; slots: Slot[] } | null {
  const movable = isFlexible(conflict.b.type) ? conflict.b : isFlexible(conflict.a.type) ? conflict.a : null;
  if (!movable) return null;
  const duration = absMinutes(movable.end) - absMinutes(movable.start);
  const others = allItems.filter((i) => i.key !== movable.key);
  const slots: Slot[] = [];
  for (let d = 0; d < days && slots.length < max; d++) {
    const date = addDays(dateOf(movable.start), d);
    for (const gap of freeSlots(others, date, duration)) {
      // Offer the start of each gap, sized to the original duration.
      slots.push({ start: gap.start, end: fromAbsMinutes(absMinutes(gap.start) + duration) });
      if (slots.length >= max) break;
    }
  }
  return { item: movable, slots };
}
