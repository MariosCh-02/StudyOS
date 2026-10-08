/**
 * Topic mastery (0–100) from practice evidence, and adaptive question choice.
 */
import { dayNumber, type DateKey } from "./time";

export interface Evidence {
  /** 0..1: question score, or a flashcard rating mapped to recall strength. */
  score: number;
  date: DateKey;
  /** 1..5; harder questions count a little more. */
  difficulty?: number;
}

const RECENCY = 0.85; // weight multiplier per newer piece of evidence
const HALF_LIFE_DAYS = 60;

/**
 * Mastery combines (a) recency-weighted accuracy, so recent results matter
 * most, with (b) confidence that grows with the amount of evidence, so one
 * lucky answer isn't "mastered". Old evidence fades with a 60-day half-life.
 * Returns null when there is no evidence.
 */
export function mastery(evidence: Evidence[], today: DateKey): number | null {
  if (evidence.length === 0) return null;
  const sorted = [...evidence].sort((a, b) => b.date.localeCompare(a.date)); // newest first
  let num = 0;
  let den = 0;
  let effective = 0;
  sorted.forEach((e, i) => {
    const age = Math.max(0, dayNumber(today) - dayNumber(e.date));
    const fade = 0.5 ** (age / HALF_LIFE_DAYS);
    const w = RECENCY ** i * fade * (0.8 + 0.1 * (e.difficulty ?? 3));
    num += w * Math.min(1, Math.max(0, e.score));
    den += w;
    effective += fade;
  });
  const accuracy = num / den;
  const confidence = 1 - Math.exp(-effective / 4);
  return Math.round(accuracy * confidence * 100);
}

export type MasteryBand = "new" | "weak" | "developing" | "strong" | "mastered";

export function masteryBand(m: number | null): MasteryBand {
  if (m == null) return "new";
  if (m < 40) return "weak";
  if (m < 70) return "developing";
  if (m < 90) return "strong";
  return "mastered";
}

// ------------------------------------------------------------- adaptivity

export interface PoolItem {
  id: string;
  difficulty: number;
  topicId: string | null;
}

export interface AdaptiveState {
  /** Current estimated level, 1..5. */
  level: number;
  asked: Set<string>;
}

export const startAdaptive = (level = 3): AdaptiveState => ({ level, asked: new Set() });

/** Correct answers raise the level by ½, wrong ones lower it by ¾ (clamped 1..5). */
export function updateLevel(state: AdaptiveState, score: number): AdaptiveState {
  const delta = score >= 1 ? 0.5 : score > 0 ? 0 : -0.75;
  return { ...state, level: Math.min(5, Math.max(1, state.level + delta)) };
}

/**
 * Next question: closest to the current level, nudged towards weak topics
 * (low mastery) and away from recently answered questions. `random` is
 * injectable for tests; ties are broken randomly.
 */
export function pickNext(
  pool: PoolItem[],
  state: AdaptiveState,
  topicMastery: ReadonlyMap<string, number | null>,
  recentlyAnswered: ReadonlySet<string> = new Set(),
  random: () => number = Math.random,
): PoolItem | null {
  const candidates = pool.filter((q) => !state.asked.has(q.id));
  if (!candidates.length) return null;
  let best: PoolItem | null = null;
  let bestScore = Infinity;
  for (const q of candidates) {
    const m = q.topicId ? (topicMastery.get(q.topicId) ?? null) : null;
    const weakness = m == null ? 0.3 : (100 - m) / 100; // 0 strong … 1 weak
    const score = Math.abs(q.difficulty - state.level) - 0.8 * weakness + (recentlyAnswered.has(q.id) ? 1.5 : 0) + random() * 0.3;
    if (score < bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
}

/** Another question on the same topic (for "try a similar question"). */
export function similarQuestion(pool: PoolItem[], to: PoolItem, exclude: ReadonlySet<string>): PoolItem | null {
  const same = pool.filter((q) => q.id !== to.id && !exclude.has(q.id) && q.topicId != null && q.topicId === to.topicId);
  if (!same.length) return null;
  return same.sort((a, b) => Math.abs(a.difficulty - to.difficulty) - Math.abs(b.difficulty - to.difficulty))[0]!;
}
