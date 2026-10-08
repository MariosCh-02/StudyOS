/**
 * Weighted course assessment: current standing and the score needed on the
 * remaining work to reach a target. All values are percentages (0–100).
 */

export interface Component {
  /** Share of the course grade, in percent (e.g. 20 for 20%). */
  weight: number | null;
  /** Achieved percentage, or null when not graded yet. */
  percent: number | null;
}

export interface Standing {
  /** Sum of all weights (should be 100; a warning is shown otherwise). */
  totalWeight: number;
  gradedWeight: number;
  remainingWeight: number;
  /** Weighted points already earned, out of totalWeight. */
  earned: number;
  /** Average over graded work only; null if nothing is graded. */
  current: number | null;
  /** Final grade if every remaining component scored 0 / 100. */
  floor: number | null;
  ceiling: number | null;
  /** Components without a weight (ignored in the calculation). */
  unweighted: number;
}

export function percentOf(score: number | null, max: number | null): number | null {
  if (score == null || max == null || !(max > 0)) return null;
  return (score / max) * 100;
}

export function standing(components: Component[]): Standing {
  const weighted = components.filter((c): c is { weight: number; percent: number | null } => c.weight != null && c.weight > 0);
  const totalWeight = weighted.reduce((s, c) => s + c.weight, 0);
  const graded = weighted.filter((c) => c.percent != null);
  const gradedWeight = graded.reduce((s, c) => s + c.weight, 0);
  const earned = graded.reduce((s, c) => s + (c.weight * c.percent!) / 100, 0);
  const remainingWeight = totalWeight - gradedWeight;
  return {
    totalWeight,
    gradedWeight,
    remainingWeight,
    earned,
    current: gradedWeight > 0 ? (earned / gradedWeight) * 100 : null,
    floor: totalWeight > 0 ? (earned / totalWeight) * 100 : null,
    ceiling: totalWeight > 0 ? ((earned + remainingWeight) / totalWeight) * 100 : null,
    unweighted: components.length - weighted.length,
  };
}

export type Requirement =
  | { status: "secured" }
  | { status: "possible"; required: number }
  | { status: "impossible"; required: number; best: number }
  | { status: "complete"; final: number }
  | { status: "unknown" };

/** Average score needed on all remaining components to finish with `target` %. */
export function requiredFor(s: Standing, target: number): Requirement {
  if (s.totalWeight <= 0) return { status: "unknown" };
  if (s.remainingWeight <= 1e-9) return { status: "complete", final: (s.earned / s.totalWeight) * 100 };
  const required = ((target * s.totalWeight) / 100 - s.earned) / (s.remainingWeight / 100);
  if (required <= 0) return { status: "secured" };
  if (required > 100) return { status: "impossible", required, best: s.ceiling ?? 0 };
  return { status: "possible", required };
}

export const DEFAULT_TARGETS = [70, 80, 90, 95];
