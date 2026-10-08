/**
 * Academic performance for the active programme: GPA (final and projected),
 * per-course standings, attendance, study time and Top Student Mode input.
 */
import { requiredFor, standing } from "@/domain/assessment";
import { computeProgrammeStats, fromPercent, toPercent, weightedAverage, type ProgrammeStats } from "@/domain/grading";
import { recommendations, type Recommendation } from "@/domain/recommendations";
import { daysUntil, minutesByCourse, studyTotals, type StudyTotals } from "@/domain/tracking";
import { addDays, dateOf, nowLocal } from "@/domain/time";
import type { Course, Semester } from "@/domain/types";
import { listAssignments, listExams, toGradedItems } from "./assessments";
import { listCourses } from "./courses";
import { getProgramme, listProgrammes, repairActiveProgramme, type ProgrammeWithInstitution } from "./programmes";
import { getCourseAttendance, listStudySessions, listTasks } from "./tracking";
import { listSemestersForProgramme } from "./terms";

export interface CoursePerformance {
  course: Course;
  /** Weighted average of graded assessments (percent), null if none graded. */
  currentPercent: number | null;
  /** currentPercent converted to the programme scale. */
  currentOnScale: number | null;
  /** Final grade if set, else the current standing on the programme scale. */
  effectiveGrade: number | null;
  /** Required average (percent) on remaining work to reach the course (or programme) target. */
  requiredForTarget: number | null;
  targetReachable: boolean | null;
  gradedWeight: number;
  totalWeight: number;
  attendanceRate: number | null;
  attendanceUnmarked: number;
  studyMinutes14: number;
  studyMinutesTotal: number;
}

export interface PerformanceData {
  programme: ProgrammeWithInstitution;
  semesters: Semester[];
  courses: CoursePerformance[];
  /** Final grades only. */
  stats: ProgrammeStats;
  /** Final grades plus current standings of in-progress courses. */
  projectedAverage: number | null;
  /** Credit-weighted across all programmes, as a percentage of each scale. */
  cumulativePercent: number | null;
  semesterAverages: { semester: Semester; average: number | null; credits: number }[];
  assignmentAverage: number | null;
  examAverage: number | null;
  study: StudyTotals;
  overdueCount: number;
  upcoming: { title: string; courseName: string; daysAway: number; weight: number | null; kind: "assignment" | "exam"; id: string; when: string }[];
  recommendations: Recommendation[];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export async function getPerformance(weekStart: 1 | 7 = 1): Promise<PerformanceData | null> {
  const activeId = await repairActiveProgramme();
  const programme = activeId ? await getProgramme(activeId) : null;
  if (!programme) return null;
  const scale = programme.gradingScale;
  const now = nowLocal();
  const today = dateOf(now);

  const [courses, semesters, assignments, exams, sessions, tasks, allProgrammes] = await Promise.all([
    listCourses({ programmeId: programme.id }),
    listSemestersForProgramme(programme.id),
    listAssignments(),
    listExams(),
    listStudySessions(),
    listTasks({ open: true }),
    listProgrammes(),
  ]);
  const courseIds = new Set(courses.map((c) => c.id));
  const progAssignments = assignments.filter((a) => courseIds.has(a.courseId));
  const progExams = exams.filter((e) => courseIds.has(e.courseId));
  const recentMinutes = minutesByCourse(sessions.filter((s) => s.start >= `${addDays(today, -13)}T00:00`));
  const totalMinutes = minutesByCourse(sessions);

  const perCourse: CoursePerformance[] = [];
  for (const c of courses.filter((x) => x.status !== "dropped")) {
    const items = toGradedItems(
      progAssignments.filter((a) => a.courseId === c.id),
      progExams.filter((e) => e.courseId === c.id),
    );
    const s = standing(items);
    const currentOnScale = s.current != null ? fromPercent(scale, s.current) : null;
    const target = c.targetGrade ?? programme.targetGrade;
    const req = target != null ? requiredFor(s, toPercent(scale, target)) : null;
    const attendance = await getCourseAttendance(c.id, today);
    perCourse.push({
      course: c,
      currentPercent: s.current,
      currentOnScale,
      effectiveGrade: c.finalGrade ?? currentOnScale,
      requiredForTarget: req?.status === "possible" || req?.status === "impossible" ? req.required : req?.status === "secured" ? 0 : null,
      targetReachable: req == null ? null : req.status === "impossible" ? false : req.status === "complete" ? req.final >= toPercent(scale, target!) : true,
      gradedWeight: s.gradedWeight,
      totalWeight: s.totalWeight,
      attendanceRate: attendance.stats.rate,
      attendanceUnmarked: attendance.stats.unmarked,
      studyMinutes14: recentMinutes.get(c.id) ?? 0,
      studyMinutesTotal: totalMinutes.get(c.id) ?? 0,
    });
  }

  const stats = computeProgrammeStats(courses, scale, programme.totalCredits);
  const projectedAverage = weightedAverage(perCourse.map((p) => ({ grade: p.effectiveGrade, credits: p.course.credits })));

  // Cumulative across programmes: each final grade as a percentage of its own scale.
  const cumulativeItems: { grade: number; credits: number | null }[] = [];
  for (const p of allProgrammes) {
    const list = p.id === programme.id ? courses : await listCourses({ programmeId: p.id });
    for (const c of list) if (c.finalGrade != null && c.status !== "dropped") cumulativeItems.push({ grade: toPercent(p.gradingScale, c.finalGrade), credits: c.credits });
  }

  const semesterAverages = semesters.map((sem) => {
    const list = courses.filter((c) => c.semesterId === sem.id);
    const st = computeProgrammeStats(list, scale, null);
    return { semester: sem, average: st.average, credits: list.reduce((n, c) => n + (c.credits ?? 0), 0) };
  });

  const pct = (score: number | null, max: number | null) => (score != null && max ? (score / max) * 100 : null);
  const assignmentAverage = avg(progAssignments.map((a) => pct(a.score, a.maxScore)).filter((x): x is number => x != null));
  const examAverage = avg(progExams.map((e) => pct(e.score, e.maxScore)).filter((x): x is number => x != null));

  const upcoming = [
    ...progAssignments
      .filter((a) => a.dueAt && a.dueAt >= now && (a.status === "not_started" || a.status === "in_progress"))
      .map((a) => ({ id: a.id, kind: "assignment" as const, title: a.title, courseName: a.courseName, weight: a.weight, when: a.dueAt!, daysAway: daysUntil(a.dueAt!, now) })),
    ...progExams
      .filter((e) => e.startAt && e.startAt >= now && e.score == null)
      .map((e) => ({ id: e.id, kind: "exam" as const, title: e.title, courseName: e.courseName, weight: e.weight, when: e.startAt!, daysAway: daysUntil(e.startAt!, now) })),
  ].sort((a, b) => a.when.localeCompare(b.when));

  const overdueCount =
    progAssignments.filter((a) => a.dueAt && a.dueAt < now && (a.status === "not_started" || a.status === "in_progress")).length +
    tasks.filter((t) => t.dueAt && t.dueAt < now).length;

  const study = studyTotals(sessions, now, weekStart);
  const fmt = (v: number) => v.toFixed(scale.decimals);

  return {
    programme,
    semesters,
    courses: perCourse,
    stats,
    projectedAverage,
    cumulativePercent: weightedAverage(cumulativeItems),
    semesterAverages,
    assignmentAverage,
    examAverage,
    study,
    overdueCount,
    upcoming,
    recommendations: recommendations({
      courses: perCourse
        .filter((p) => p.course.status === "in_progress")
        .map((p) => ({
          id: p.course.id,
          name: p.course.name,
          currentPercent: p.currentPercent,
          requiredForTarget: p.requiredForTarget,
          attendanceRate: p.attendanceRate,
          studyMinutes14: p.studyMinutes14,
        })),
      upcoming,
      overdueCount,
      activeDays14: study.activeDays14,
      gpa: projectedAverage,
      targetGpa: programme.targetGrade,
      formatGrade: fmt,
    }),
  };
}
