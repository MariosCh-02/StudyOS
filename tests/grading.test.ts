import { describe, expect, it } from "vitest";
import {
  computeProgrammeStats,
  formatGrade,
  fromPercent,
  isPassing,
  letterFor,
  parseGradingScale,
  scaleFromPreset,
  toPercent,
  validateGradingScale,
  weightedAverage,
  DEFAULT_GRADING_SCALE,
} from "../src/domain/grading";

describe("weightedAverage", () => {
  it("returns null when nothing is graded", () => {
    expect(weightedAverage([])).toBeNull();
    expect(weightedAverage([{ grade: null, credits: 5 }])).toBeNull();
  });

  it("weights by credits (ECTS)", () => {
    const avg = weightedAverage([
      { grade: 9, credits: 10 },
      { grade: 6, credits: 5 },
    ]);
    expect(avg).toBeCloseTo(8, 10);
  });

  it("falls back to a plain mean when no item has credits", () => {
    expect(weightedAverage([{ grade: 8, credits: null }, { grade: 6, credits: 0 }])).toBe(7);
  });

  it("ignores un-weighted items when others carry credits", () => {
    expect(weightedAverage([{ grade: 10, credits: 5 }, { grade: 0, credits: null }])).toBe(10);
  });
});

describe("grading scales", () => {
  it("validates presets", () => {
    for (const p of ["ten_point", "four_point", "percentage", "letter", "custom"] as const) {
      expect(validateGradingScale(scaleFromPreset(p))).toEqual([]);
    }
  });

  it("rejects inverted ranges and out-of-range pass marks", () => {
    expect(validateGradingScale({ preset: "custom", min: 10, max: 0, pass: 5, decimals: 2 })).toContain(
      "Maximum must be greater than minimum.",
    );
    expect(validateGradingScale({ preset: "custom", min: 0, max: 10, pass: 11, decimals: 2 })).toContain(
      "Passing grade must be within the scale.",
    );
  });

  it("parses stored JSON and falls back on garbage", () => {
    expect(parseGradingScale(JSON.stringify(scaleFromPreset("percentage"))).preset).toBe("percentage");
    expect(parseGradingScale("{not json")).toEqual(DEFAULT_GRADING_SCALE);
    expect(parseGradingScale(null)).toEqual(DEFAULT_GRADING_SCALE);
  });

  it("formats grades per scale", () => {
    expect(formatGrade(scaleFromPreset("ten_point"), 8.5)).toBe("8.50");
    expect(formatGrade(scaleFromPreset("percentage"), 72.25)).toBe("72.3%");
    expect(formatGrade(scaleFromPreset("letter"), 3.7)).toBe("A- (3.70)");
    expect(formatGrade(scaleFromPreset("ten_point"), null)).toBe("—");
  });

  it("maps letter bands by lower bound", () => {
    const s = scaleFromPreset("letter");
    expect(letterFor(s, 4)).toBe("A");
    expect(letterFor(s, 3.5)).toBe("B+");
    expect(letterFor(s, 0.5)).toBe("F");
  });

  it("converts to and from percentages", () => {
    const s = scaleFromPreset("ten_point");
    expect(toPercent(s, 7.5)).toBe(75);
    expect(fromPercent(s, 90)).toBe(9);
  });

  it("checks pass marks", () => {
    const s = scaleFromPreset("ten_point");
    expect(isPassing(s, 5)).toBe(true);
    expect(isPassing(s, 4.99)).toBe(false);
  });
});

describe("computeProgrammeStats", () => {
  const scale = scaleFromPreset("ten_point");

  it("computes average, earned credits and progress", () => {
    const stats = computeProgrammeStats(
      [
        { status: "completed", finalGrade: 9, credits: 10 },
        { status: "completed", finalGrade: 4, credits: 5 }, // failed: not earned
        { status: "completed", finalGrade: null, credits: 5 }, // pass/fail: earned
        { status: "in_progress", finalGrade: null, credits: 10 },
        { status: "dropped", finalGrade: 2, credits: 10 }, // ignored entirely
      ],
      scale,
      90,
    );
    expect(stats.average).toBeCloseTo((9 * 10 + 4 * 5) / 15, 10);
    expect(stats.earnedCredits).toBe(15);
    expect(stats.gradedCredits).toBe(15);
    expect(stats.progress).toBeCloseTo(15 / 90, 10);
    expect(stats.courseCount).toBe(4);
    expect(stats.completedCount).toBe(3);
    expect(stats.inProgressCount).toBe(1);
  });

  it("reports unknown progress without a credit total", () => {
    expect(computeProgrammeStats([], scale, null).progress).toBeNull();
    expect(computeProgrammeStats([], scale, 0).progress).toBeNull();
  });

  it("clamps progress at 100%", () => {
    expect(computeProgrammeStats([{ status: "completed", finalGrade: 8, credits: 200 }], scale, 90).progress).toBe(1);
  });
});
