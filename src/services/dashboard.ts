import type { Course, Semester } from "@/domain/types";
import { computeProgrammeStats, type ProgrammeStats } from "@/domain/grading";
import { pickCurrentPeriod } from "@/domain/dates";
import { listCourses } from "./courses";
import { getProgramme, listProgrammes, repairActiveProgramme, type ProgrammeWithInstitution } from "./programmes";
import { getProfile } from "./settings";
import { listSemestersForProgramme } from "./terms";

export interface DashboardData {
  displayName: string;
  programme: ProgrammeWithInstitution | null;
  stats: ProgrammeStats | null;
  currentSemester: Semester | null;
  /** Courses in the current semester, or in-progress courses when no semester applies. */
  currentCourses: Course[];
  semesterStats: ProgrammeStats | null;
}

export interface ProgrammeSummary {
  programme: ProgrammeWithInstitution;
  stats: ProgrammeStats;
}

/** Every programme with its aggregate stats, computed from two queries. */
export async function listProgrammeSummaries(): Promise<ProgrammeSummary[]> {
  const [programmes, courses] = await Promise.all([listProgrammes(), listCourses()]);
  const byProgramme = new Map<string, Course[]>();
  for (const c of courses) byProgramme.set(c.programmeId, [...(byProgramme.get(c.programmeId) ?? []), c]);
  return programmes.map((p) => ({
    programme: p,
    stats: computeProgrammeStats(byProgramme.get(p.id) ?? [], p.gradingScale, p.totalCredits),
  }));
}

export async function getDashboard(today: string): Promise<DashboardData> {
  const [profile, activeId] = await Promise.all([getProfile(), repairActiveProgramme()]);
  const programme = activeId ? await getProgramme(activeId) : null;
  if (!programme) {
    return { displayName: profile.displayName, programme: null, stats: null, currentSemester: null, currentCourses: [], semesterStats: null };
  }

  const [courses, semesters] = await Promise.all([
    listCourses({ programmeId: programme.id }),
    listSemestersForProgramme(programme.id),
  ]);
  const currentSemester = pickCurrentPeriod(semesters, today);
  const semesterCourses = currentSemester ? courses.filter((c) => c.semesterId === currentSemester.id) : [];
  const currentCourses = currentSemester
    ? semesterCourses.filter((c) => c.status !== "dropped")
    : courses.filter((c) => c.status === "in_progress");

  return {
    displayName: profile.displayName,
    programme,
    stats: computeProgrammeStats(courses, programme.gradingScale, programme.totalCredits),
    currentSemester,
    currentCourses,
    semesterStats: currentSemester ? computeProgrammeStats(semesterCourses, programme.gradingScale, null) : null,
  };
}
