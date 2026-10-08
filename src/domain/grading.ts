/**
 * Grading scales and grade aggregation.
 *
 * Every grade in StudyOS is stored as a number on its programme's scale.
 * Letter scales map each letter to a numeric value (grade points), so all
 * calculations work the same way regardless of how grades are displayed.
 */

export type GradingPreset = "ten_point" | "four_point" | "percentage" | "letter" | "custom";

export interface LetterBand {
  label: string;
  /** Grade value this letter represents; also the lower bound of its band. */
  value: number;
}

export interface GradingScale {
  preset: GradingPreset;
  min: number;
  max: number;
  /** Lowest passing grade. */
  pass: number;
  decimals: number;
  /** Present for letter scales, ordered from highest to lowest value. */
  letters?: LetterBand[];
}

const US_LETTERS: LetterBand[] = [
  { label: "A", value: 4.0 },
  { label: "A-", value: 3.7 },
  { label: "B+", value: 3.3 },
  { label: "B", value: 3.0 },
  { label: "B-", value: 2.7 },
  { label: "C+", value: 2.3 },
  { label: "C", value: 2.0 },
  { label: "C-", value: 1.7 },
  { label: "D+", value: 1.3 },
  { label: "D", value: 1.0 },
  { label: "F", value: 0 },
];

export const GRADING_PRESETS: Record<GradingPreset, { label: string; scale: GradingScale }> = {
  ten_point: { label: "10-point scale (0–10)", scale: { preset: "ten_point", min: 0, max: 10, pass: 5, decimals: 2 } },
  four_point: { label: "4.0 GPA (0–4)", scale: { preset: "four_point", min: 0, max: 4, pass: 1, decimals: 2 } },
  percentage: { label: "Percentage (0–100%)", scale: { preset: "percentage", min: 0, max: 100, pass: 50, decimals: 1 } },
  letter: {
    label: "Letter grades (A–F)",
    scale: { preset: "letter", min: 0, max: 4, pass: 1, decimals: 2, letters: US_LETTERS },
  },
  custom: { label: "Custom scale", scale: { preset: "custom", min: 0, max: 20, pass: 10, decimals: 2 } },
};

export const DEFAULT_GRADING_SCALE: GradingScale = GRADING_PRESETS.ten_point.scale;

export function scaleFromPreset(preset: GradingPreset): GradingScale {
  const s = GRADING_PRESETS[preset].scale;
  return { ...s, letters: s.letters?.map((l) => ({ ...l })) };
}

/** Returns human-readable problems with a scale; empty when valid. */
export function validateGradingScale(scale: GradingScale): string[] {
  const errors: string[] = [];
  const finite = [scale.min, scale.max, scale.pass, scale.decimals].every(Number.isFinite);
  if (!finite) return ["All scale values must be numbers."];
  if (scale.max <= scale.min) errors.push("Maximum must be greater than minimum.");
  if (scale.pass < scale.min || scale.pass > scale.max) errors.push("Passing grade must be within the scale.");
  if (!Number.isInteger(scale.decimals) || scale.decimals < 0 || scale.decimals > 4)
    errors.push("Decimals must be a whole number between 0 and 4.");
  if (scale.letters) {
    if (scale.letters.length === 0) errors.push("A letter scale needs at least one letter.");
    for (const l of scale.letters) {
      if (!l.label.trim()) errors.push("Letter labels cannot be empty.");
      if (l.value < scale.min || l.value > scale.max) errors.push(`Letter ${l.label} is outside the scale.`);
    }
  }
  return errors;
}

/** Parses a stored JSON scale, falling back to the default when invalid. */
export function parseGradingScale(json: string | null | undefined): GradingScale {
  if (!json) return DEFAULT_GRADING_SCALE;
  try {
    const s = JSON.parse(json) as GradingScale;
    return validateGradingScale(s).length === 0 ? s : DEFAULT_GRADING_SCALE;
  } catch {
    return DEFAULT_GRADING_SCALE;
  }
}

export function isValidGrade(scale: GradingScale, value: number): boolean {
  return Number.isFinite(value) && value >= scale.min && value <= scale.max;
}

/** A grade rounded the way it is displayed, so text, letters and pass/target checks agree. */
export function roundGrade(scale: GradingScale, value: number): number {
  return Number(value.toFixed(scale.decimals));
}

export function isPassing(scale: GradingScale, value: number): boolean {
  return roundGrade(scale, value) >= scale.pass;
}

/** Highest letter whose value is at or below `value`. */
export function letterFor(scale: GradingScale, value: number): string | null {
  if (!scale.letters?.length) return null;
  const sorted = [...scale.letters].sort((a, b) => b.value - a.value);
  return (sorted.find((l) => value >= l.value - 1e-9) ?? sorted[sorted.length - 1]!).label;
}

export function formatGrade(scale: GradingScale, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const num = value.toFixed(scale.decimals);
  const letter = letterFor(scale, roundGrade(scale, value));
  if (letter) return `${letter} (${num})`;
  return scale.preset === "percentage" ? `${num}%` : num;
}

export function toPercent(scale: GradingScale, value: number): number {
  return ((value - scale.min) / (scale.max - scale.min)) * 100;
}

export function fromPercent(scale: GradingScale, percent: number): number {
  return scale.min + (percent / 100) * (scale.max - scale.min);
}

export interface WeightedGrade {
  grade: number | null;
  credits: number | null;
}

/**
 * Credit-weighted average of graded items.
 * When at least one graded item carries credits, items without credits are
 * excluded (they cannot be weighted). When none do, a plain mean is used.
 * Returns null when nothing is graded.
 */
export function weightedAverage(items: WeightedGrade[]): number | null {
  const graded = items.filter((i): i is { grade: number; credits: number | null } => i.grade != null && Number.isFinite(i.grade));
  if (graded.length === 0) return null;
  const weighted = graded.filter((i) => i.credits != null && i.credits > 0);
  if (weighted.length === 0) return graded.reduce((s, i) => s + i.grade, 0) / graded.length;
  const totalWeight = weighted.reduce((s, i) => s + i.credits!, 0);
  return weighted.reduce((s, i) => s + i.grade * i.credits!, 0) / totalWeight;
}

export interface CourseGradeRecord {
  status: "planned" | "in_progress" | "completed" | "dropped";
  finalGrade: number | null;
  credits: number | null;
}

export interface ProgrammeStats {
  /** Credit-weighted average of all final grades; null if none. */
  average: number | null;
  courseCount: number;
  completedCount: number;
  inProgressCount: number;
  /** Credits from completed courses that were passed (or ungraded pass/fail). */
  earnedCredits: number;
  /** Credits attached to the courses that make up `average`. */
  gradedCredits: number;
  /** earnedCredits / totalCredits, clamped to [0, 1]; null when total unknown. */
  progress: number | null;
}

export function computeProgrammeStats(
  courses: CourseGradeRecord[],
  scale: GradingScale,
  totalCredits: number | null,
): ProgrammeStats {
  const counted = courses.filter((c) => c.status !== "dropped");
  const graded = counted.filter((c) => c.finalGrade != null);
  const earnedCredits = counted
    .filter((c) => c.status === "completed" && (c.finalGrade == null || isPassing(scale, c.finalGrade)))
    .reduce((s, c) => s + (c.credits ?? 0), 0);
  return {
    average: weightedAverage(graded.map((c) => ({ grade: c.finalGrade, credits: c.credits }))),
    courseCount: counted.length,
    completedCount: counted.filter((c) => c.status === "completed").length,
    inProgressCount: counted.filter((c) => c.status === "in_progress").length,
    earnedCredits,
    gradedCredits: graded.reduce((s, c) => s + (c.credits ?? 0), 0),
    progress: totalCredits && totalCredits > 0 ? Math.min(1, Math.max(0, earnedCredits / totalCredits)) : null,
  };
}

/**
 * "What if?" projection: replaces (or supplies) final grades for selected
 * courses and recomputes the programme statistics. Overridden in-progress
 * courses are treated as completed with that grade.
 */
export function whatIf<T extends CourseGradeRecord & { id: string }>(
  courses: T[],
  overrides: ReadonlyMap<string, number>,
  scale: GradingScale,
  totalCredits: number | null,
): ProgrammeStats {
  const projected = courses.map((c) =>
    overrides.has(c.id) && c.status !== "dropped" ? { ...c, finalGrade: overrides.get(c.id)!, status: "completed" as const } : c,
  );
  return computeProgrammeStats(projected, scale, totalCredits);
}

/** Converts a percentage to the programme scale, rounded to the scale's decimals. */
export function percentToScale(scale: GradingScale, percent: number): number {
  const v = fromPercent(scale, Math.min(100, Math.max(0, percent)));
  const f = 10 ** scale.decimals;
  return Math.round(v * f) / f;
}
