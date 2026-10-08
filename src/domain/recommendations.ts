/**
 * Top Student Mode: concrete recommendations derived only from stored data.
 * Never claims anything StudyOS can't know (e.g. class ranking).
 */

export interface CourseSnapshot {
  id: string;
  name: string;
  /** Current weighted average in percent (graded work only), if any. */
  currentPercent: number | null;
  /** Required average on remaining work to hit the course target, if computable. */
  requiredForTarget: number | null;
  attendanceRate: number | null;
  studyMinutes14: number;
}

export interface UpcomingAssessment {
  title: string;
  courseName: string;
  daysAway: number;
  weight: number | null;
  kind: "assignment" | "exam";
}

export interface RecommendationInput {
  courses: CourseSnapshot[];
  upcoming: UpcomingAssessment[];
  overdueCount: number;
  activeDays14: number;
  gpa: number | null;
  targetGpa: number | null;
  formatGrade: (v: number) => string;
}

export interface Recommendation {
  priority: 1 | 2 | 3;
  text: string;
}

export function recommendations(i: RecommendationInput): Recommendation[] {
  const out: Recommendation[] = [];
  const pct = (v: number) => `${Math.round(v)}%`;

  if (i.overdueCount > 0) out.push({ priority: 1, text: `You have ${i.overdueCount} overdue item${i.overdueCount === 1 ? "" : "s"}. Clear or reschedule them first.` });

  const graded = i.courses.filter((c) => c.currentPercent != null).sort((a, b) => a.currentPercent! - b.currentPercent!);
  if (graded.length >= 2) {
    const weakest = graded[0]!;
    out.push({ priority: 1, text: `Your lowest current course average is ${pct(weakest.currentPercent!)} in ${weakest.name}. Consider prioritising this course.` });
  }

  for (const c of i.courses) {
    if (c.requiredForTarget != null && c.requiredForTarget > 100) {
      out.push({ priority: 2, text: `${c.name}: your course target is no longer reachable with the remaining assessments. Consider adjusting it.` });
    } else if (c.requiredForTarget != null && c.requiredForTarget >= 85) {
      out.push({ priority: 1, text: `${c.name}: you need an average of ${pct(c.requiredForTarget)} on the remaining work to reach your target.` });
    }
    if (c.attendanceRate != null && c.attendanceRate < 0.8) {
      out.push({ priority: 2, text: `Attendance in ${c.name} is ${pct(c.attendanceRate * 100)}. Missing classes is often linked to weaker results.` });
    }
  }

  const soon = i.upcoming.filter((u) => u.daysAway >= 0 && u.daysAway <= 14).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.daysAway - b.daysAway);
  const big = soon[0];
  if (big) {
    out.push({
      priority: big.daysAway <= 3 ? 1 : 2,
      text: `${big.kind === "exam" ? "Exam" : "Deadline"}: ${big.title} (${big.courseName}) in ${big.daysAway} day${big.daysAway === 1 ? "" : "s"}${big.weight ? `, worth ${big.weight}%` : ""}. Plan time for it now.`,
    });
  }

  const neglected = i.courses.filter((c) => c.studyMinutes14 === 0);
  if (neglected.length && i.courses.length > 1) {
    out.push({ priority: 2, text: `No study time logged in the last 14 days for ${neglected.map((c) => c.name).join(", ")}.` });
  }

  if (i.activeDays14 < 7) out.push({ priority: 3, text: `You studied on ${i.activeDays14} of the last 14 days. Short daily sessions beat occasional long ones.` });

  if (i.gpa != null && i.targetGpa != null) {
    // Compare as displayed, so 7.996 against a target of 8 counts as meeting it (both show 8.00).
    if (i.gpa >= i.targetGpa || i.formatGrade(i.gpa) === i.formatGrade(i.targetGpa)) out.push({ priority: 3, text: `Your current average (${i.formatGrade(i.gpa)}) meets your target (${i.formatGrade(i.targetGpa)}). Keep the consistency going.` });
    else out.push({ priority: 2, text: `Your current average is ${i.formatGrade(i.gpa)}; your target is ${i.formatGrade(i.targetGpa)}.` });
  }

  return out.sort((a, b) => a.priority - b.priority);
}
