/**
 * Spaced repetition (SM-2 family, Anki-style ratings) with day granularity.
 */
import { addDays, type DateKey } from "./time";

export type Rating = "again" | "hard" | "good" | "easy";
export const RATINGS: Rating[] = ["again", "hard", "good", "easy"];

export interface SrsState {
  dueDate: DateKey;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  lastReview: DateKey | null;
}

export const INITIAL_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_INTERVAL = 3650;

/** A card that has never been reviewed: due now. */
export const newState = (today: DateKey): SrsState => ({ dueDate: today, intervalDays: 0, ease: INITIAL_EASE, reps: 0, lapses: 0, lastReview: null });

/**
 * Schedules the next review.
 * - New cards: Again → today, Hard/Good → 1 day, Easy → 4 days.
 * - Reviews: Again resets to 1 day and lowers ease; Hard ×1.2; Good ×ease;
 *   Easy ×ease×1.3. Reviews done late get credit for the extra delay
 *   (as in SM-2), and every successful review grows by at least one day.
 */
export function review(state: SrsState, rating: Rating, today: DateKey): SrsState {
  const next = { ...state, reps: state.reps + 1, lastReview: today };
  if (state.reps === 0 || state.intervalDays === 0) {
    const interval = rating === "again" ? 0 : rating === "easy" ? 4 : 1;
    return { ...next, intervalDays: interval, dueDate: addDays(today, interval), ease: rating === "easy" ? state.ease + 0.15 : state.ease };
  }

  if (rating === "again") {
    const ease = Math.max(MIN_EASE, state.ease - 0.2);
    return { ...next, ease, lapses: state.lapses + 1, intervalDays: 1, dueDate: addDays(today, 1) };
  }

  const daysLate = state.lastReview ? Math.max(0, dayDiff(state.dueDate, today)) : 0;
  const base = state.intervalDays;
  let ease = state.ease;
  let interval: number;
  if (rating === "hard") {
    ease = Math.max(MIN_EASE, ease - 0.15);
    interval = base * 1.2 + daysLate / 4;
  } else if (rating === "good") {
    interval = (base + daysLate / 2) * ease;
  } else {
    ease = ease + 0.15;
    interval = (base + daysLate) * ease * 1.3;
  }
  const days = Math.min(MAX_INTERVAL, Math.max(base + 1, Math.round(interval)));
  return { ...next, ease, intervalDays: days, dueDate: addDays(today, days) };
}

function dayDiff(from: DateKey, to: DateKey): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Preview of the interval each rating would give (shown on the buttons). */
export function previewIntervals(state: SrsState, today: DateKey): Record<Rating, number> {
  return Object.fromEntries(RATINGS.map((r) => [r, review(state, r, today).intervalDays])) as Record<Rating, number>;
}

export function formatInterval(days: number): string {
  if (days <= 0) return "today";
  if (days < 30) return `${days} d`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${(days / 365).toFixed(1)} y`;
}

/** Maps a graded answer to a rating, so questions share the flashcard schedule. */
export const ratingForScore = (score: number): Rating => (score >= 1 ? "good" : score >= 0.5 ? "hard" : "again");

/** Recall strength of a rating, used by mastery. */
export const RATING_SCORE: Record<Rating, number> = { again: 0, hard: 0.6, good: 0.9, easy: 1 };
