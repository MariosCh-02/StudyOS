import { describe, expect, it } from "vitest";
import { percentOf, requiredFor, standing } from "../src/domain/assessment";
import { attendanceStats, daysUntil, deadlineClashes, describeDue, studyTotals } from "../src/domain/tracking";
import { planRevision } from "../src/domain/planner";
import { recommendations } from "../src/domain/recommendations";
import { percentToScale, scaleFromPreset, whatIf } from "../src/domain/grading";
import type { TimedItem } from "../src/domain/conflicts";

describe("grade calculator", () => {
  // The spec's example: A1 20% → 85, A2 20% → 90, Final 60% → ?
  const spec = [
    { weight: 20, percent: 85 },
    { weight: 20, percent: 90 },
    { weight: 60, percent: null },
  ];

  it("computes the current standing", () => {
    const s = standing(spec);
    expect(s).toMatchObject({ totalWeight: 100, gradedWeight: 40, remainingWeight: 60, earned: 35 });
    expect(s.current).toBeCloseTo(87.5, 10);
    expect(s.floor).toBeCloseTo(35, 10);
    expect(s.ceiling).toBeCloseTo(95, 10);
  });

  it("computes the score needed on the final for 70/80/90/95%", () => {
    const s = standing(spec);
    const need = (t: number) => requiredFor(s, t);
    expect(need(70)).toEqual({ status: "possible", required: expect.closeTo(58.333, 2) });
    expect(need(80)).toEqual({ status: "possible", required: expect.closeTo(75, 6) });
    expect(need(90)).toEqual({ status: "possible", required: expect.closeTo(91.667, 2) });
    expect(need(95)).toEqual({ status: "possible", required: expect.closeTo(100, 6) });
    expect(need(96)).toMatchObject({ status: "impossible", best: 95 });
    expect(need(30)).toEqual({ status: "secured" });
  });

  it("handles finished courses, missing weights and non-100 totals", () => {
    expect(requiredFor(standing([{ weight: 50, percent: 80 }, { weight: 50, percent: 60 }]), 90)).toEqual({ status: "complete", final: 70 });
    const s = standing([{ weight: 30, percent: 90 }, { weight: null, percent: 50 }, { weight: 30, percent: null }]);
    expect(s).toMatchObject({ totalWeight: 60, unweighted: 1 });
    expect(requiredFor(s, 80)).toEqual({ status: "possible", required: expect.closeTo(70, 6) });
    expect(requiredFor(standing([]), 80)).toEqual({ status: "unknown" });
    expect(percentOf(17, 20)).toBe(85);
    expect(percentOf(5, 0)).toBeNull();
  });
});

describe("what-if GPA", () => {
  const scale = scaleFromPreset("ten_point");
  const courses = [
    { id: "a", status: "completed" as const, finalGrade: 9, credits: 10 },
    { id: "b", status: "in_progress" as const, finalGrade: null, credits: 10 },
  ];
  it("projects the average with hypothetical grades", () => {
    expect(whatIf(courses, new Map(), scale, 90).average).toBe(9);
    const p = whatIf(courses, new Map([["b", 9.5]]), scale, 90);
    expect(p.average).toBeCloseTo(9.25, 10);
    expect(p.earnedCredits).toBe(20);
    expect(percentToScale(scale, 87.5)).toBe(8.75);
    expect(percentToScale(scaleFromPreset("four_point"), 90)).toBe(3.6);
  });
});

describe("study time", () => {
  const s = (start: string, minutes: number, courseId: string | null = null) => ({ start, minutes, courseId });
  it("totals today, week, month and streak", () => {
    const t = studyTotals(
      [s("2026-10-08T09:00", 50), s("2026-10-07T20:00", 25), s("2026-10-06T19:00", 90), s("2026-10-01T10:00", 60), s("2026-09-30T10:00", 30)],
      "2026-10-08T12:00",
    );
    expect(t).toMatchObject({ today: 50, week: 165, month: 225, total: 255, streak: 3 });
    expect(t.activeDays14).toBe(5);
  });
  it("keeps the streak if today has no study yet", () => {
    expect(studyTotals([s("2026-10-07T20:00", 25)], "2026-10-08T08:00").streak).toBe(1);
    expect(studyTotals([s("2026-10-05T20:00", 25)], "2026-10-08T08:00").streak).toBe(0);
  });
});

describe("attendance", () => {
  it("uses the latest record per class and counts unmarked classes", () => {
    const stats = attendanceStats(
      [
        { date: "2026-10-01", status: "absent", updatedAt: "1" },
        { date: "2026-10-01", status: "present", updatedAt: "2" },
        { date: "2026-10-06", status: "late", updatedAt: "1" },
        { date: "2026-10-08", status: "absent", updatedAt: "1" },
        { date: "2026-10-13", status: "excused", updatedAt: "1" },
      ],
      ["2026-10-01", "2026-10-06", "2026-10-08", "2026-10-13", "2026-10-15"],
    );
    expect(stats).toMatchObject({ present: 1, late: 1, absent: 1, excused: 1, unmarked: 1 });
    expect(stats.rate).toBeCloseTo(2 / 3, 10);
    expect(attendanceStats([], []).rate).toBeNull();
  });
});

describe("deadlines", () => {
  it("finds deadlines within 24 hours of each other", () => {
    const d = (key: string, due: string) => ({ key, title: key, due });
    const clashes = deadlineClashes([d("a", "2026-10-10T23:59"), d("b", "2026-10-11T09:00"), d("c", "2026-10-14T12:00")]);
    expect(clashes.map(([x, y]) => `${x.key}-${y.key}`)).toEqual(["a-b"]);
  });
  it("describes due dates relative to now", () => {
    expect(daysUntil("2026-10-20", "2026-10-08T23:00")).toBe(12);
    expect(describeDue("2026-10-08T23:59", "2026-10-08T10:00")).toBe("due today");
    expect(describeDue("2026-10-09T09:00", "2026-10-08T10:00")).toBe("due tomorrow");
    expect(describeDue("2026-10-06T09:00", "2026-10-08T10:00")).toBe("overdue by 2 days");
  });
});

describe("revision planner", () => {
  const busy: TimedItem[] = [
    { key: "work-9", type: "work", title: "Work", start: "2026-10-09T08:00", end: "2026-10-09T16:00", allDay: false },
    { key: "ml-9", type: "class", title: "ML", start: "2026-10-09T17:00", end: "2026-10-09T19:00", allDay: false },
  ];
  const base = { from: "2026-10-09", examDate: "2026-10-12", busy, sessionMinutes: 60, maxSessionsPerDay: 2 };

  it("schedules weighted topics in free time before the exam with a final review", () => {
    const plan = planRevision({ ...base, topics: [{ name: "Optimisation", weight: 3 }, { name: "Derivatives", weight: 1 }] });
    // Oct 9 only has room for one session (19:15–20:15 before 21:00); Oct 10 and 11 have two each.
    expect(plan).toHaveLength(5);
    expect(plan.every((p) => p.start >= "2026-10-09" && p.start < "2026-10-12")).toBe(true);
    expect(plan.filter((p) => p.start.startsWith("2026-10-09")).map((p) => p.start)).toEqual(["2026-10-09T19:15"]);
    const counts = plan.reduce<Record<string, number>>((m, p) => ({ ...m, [p.topic]: (m[p.topic] ?? 0) + 1 }), {});
    expect(counts["Full review"]).toBe(1);
    expect(counts.Optimisation).toBeGreaterThan(counts.Derivatives ?? 0);
    expect(plan.at(-1)?.start.startsWith("2026-10-11")).toBe(true);
  });

  it("returns nothing when there's no time or no topics", () => {
    expect(planRevision({ ...base, topics: [] })).toEqual([]);
    expect(planRevision({ ...base, examDate: "2026-10-09", topics: [{ name: "x", weight: 1 }] })).toEqual([]);
  });
});

describe("Top Student Mode recommendations", () => {
  it("prioritises the weakest course and is grounded in data", () => {
    const recs = recommendations({
      courses: [
        { id: "a", name: "Machine Learning", currentPercent: 91, requiredForTarget: 60, attendanceRate: 1, studyMinutes14: 300 },
        { id: "b", name: "Statistics", currentPercent: 82, requiredForTarget: 92, attendanceRate: 0.7, studyMinutes14: 0 },
      ],
      upcoming: [{ title: "Midterm", courseName: "Statistics", daysAway: 5, weight: 30, kind: "exam" }],
      overdueCount: 0,
      activeDays14: 4,
      gpa: 9.1,
      targetGpa: 9.5,
      formatGrade: (v) => v.toFixed(1),
    });
    const text = recs.map((r) => r.text).join("\n");
    expect(recs[0]?.text).toBe("Your lowest current course average is 82% in Statistics. Consider prioritising this course.");
    expect(text).toContain("you need an average of 92% on the remaining work");
    expect(text).toContain("Attendance in Statistics is 70%");
    expect(text).toContain("Midterm (Statistics) in 5 days, worth 30%");
    expect(text).toContain("Your current average is 9.1; your target is 9.5.");
    expect(text).not.toMatch(/rank/i);
  });
});
