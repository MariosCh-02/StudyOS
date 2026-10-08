import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ValidationError } from "@/domain/validation";
import { toDateKey } from "@/domain/dates";
import { listInstitutions } from "@/services/institutions";
import { getProgramme, listProgrammes } from "@/services/programmes";
import { listAcademicYears, listAllSemesters, listSemestersForProgramme } from "@/services/terms";
import { getCourse, listCourses } from "@/services/courses";
import { getAllSettings, getProfile } from "@/services/settings";
import { getDashboard, listProgrammeSummaries } from "@/services/dashboard";
import { getLecture, listLectures, listLecturesOn } from "@/services/lectures";
import { getNote, listNotes, type NoteFilter } from "@/services/notes";
import { listAttachments, listContextPdfs, type AttachmentOwner } from "@/services/attachments";
import { listTemplates } from "@/services/templates";
import { getCalendarItems, listRecurring } from "@/services/calendar";
import { getAssignment, getCourseStanding, getExam, listAssignments, listExams } from "@/services/assessments";
import { getCourseAttendance, listStudySessions, listTasks } from "@/services/tracking";
import { getPerformance } from "@/services/performance";
import { search, type SearchOptions } from "@/services/search";
import { listTags, tagLinksFor, itemsWithTag, type TaggableType } from "@/services/tags";
import { entriesFor, getEntry, linkedItems, listEntries, type LinkTarget } from "@/services/knowledge";
import { getDiagnostic, getLesson, getTrack, listDiagnostics, listFormulas, listLessons, listSubjects, listTopics, listTracks } from "@/services/learning";
import { getProject, listMilestones, listProjectNotes, listProjects, projectForLesson, type ProjectStatus } from "@/services/projects";
import { getPaper, listPapers, projectsForPaper, type PaperFilter } from "@/services/papers";
import { dueCounts, listFlashcards, listQuestions, listQuizSessions, topicMastery, type CardFilter, type QuestionFilter } from "@/services/practice";

export const qk = {
  institutions: ["institutions"] as const,
  programmes: ["programmes"] as const,
  programme: (id: string) => ["programme", id] as const,
  years: (programmeId: string) => ["years", programmeId] as const,
  semesters: (programmeId: string) => ["semesters", programmeId] as const,
  courses: (programmeId: string) => ["courses", programmeId] as const,
  course: (id: string) => ["course", id] as const,
  settings: ["settings"] as const,
  profile: ["profile"] as const,
  dashboard: (today: string) => ["dashboard", today] as const,
};

export const useInstitutions = () => useQuery({ queryKey: qk.institutions, queryFn: listInstitutions });
export const useProgrammes = () => useQuery({ queryKey: qk.programmes, queryFn: listProgrammes });
export const useProgramme = (id: string) => useQuery({ queryKey: qk.programme(id), queryFn: () => getProgramme(id), enabled: !!id });
export const useAcademicYears = (programmeId: string) =>
  useQuery({ queryKey: qk.years(programmeId), queryFn: () => listAcademicYears(programmeId), enabled: !!programmeId });
export const useSemesters = (programmeId: string) =>
  useQuery({ queryKey: qk.semesters(programmeId), queryFn: () => listSemestersForProgramme(programmeId), enabled: !!programmeId });
export const useCourses = (programmeId: string) =>
  useQuery({ queryKey: qk.courses(programmeId), queryFn: () => listCourses({ programmeId }), enabled: !!programmeId });
export const useCourse = (id: string) => useQuery({ queryKey: qk.course(id), queryFn: () => getCourse(id) });
export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: getAllSettings });
export const useProfile = () => useQuery({ queryKey: qk.profile, queryFn: getProfile });
export const useDashboard = () => {
  const today = toDateKey(new Date());
  return useQuery({ queryKey: qk.dashboard(today), queryFn: () => getDashboard(today) });
};

/**
 * Mutation wrapper for forms: exposes per-field validation errors and a
 * general error message, and refreshes all cached data on success
 * (the academic tree is small and tightly linked, so this stays cheap).
 */
export function useSaveMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>, onSuccess?: (r: TResult) => void) {
  const client = useQueryClient();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: fn,
    onMutate: () => {
      setFieldErrors({});
      setFormError(null);
    },
    onSuccess: async (result) => {
      await client.invalidateQueries();
      onSuccess?.(result);
    },
    onError: (err) => {
      if (err instanceof ValidationError) setFieldErrors(err.fields);
      else setFormError(err instanceof Error ? err.message : String(err));
    },
  });
  const reset = () => {
    setFieldErrors({});
    setFormError(null);
    mutation.reset();
  };
  return { ...mutation, fieldErrors, formError, reset };
}

export const useProgrammeSummaries = () =>
  useQuery({ queryKey: ["programmeSummaries"], queryFn: listProgrammeSummaries });

// ------------------------------------------------------------- Phase 2

export const useLectures = (courseId: string) =>
  useQuery({ queryKey: ["lectures", courseId], queryFn: () => listLectures(courseId), enabled: !!courseId });
export const useLecture = (id: string) => useQuery({ queryKey: ["lecture", id], queryFn: () => getLecture(id), enabled: !!id });
export const useLecturesToday = () => {
  const today = toDateKey(new Date());
  return useQuery({ queryKey: ["lecturesOn", today], queryFn: () => listLecturesOn(today) });
};
export const useNotes = (filter: NoteFilter) => useQuery({ queryKey: ["notes", filter], queryFn: () => listNotes(filter) });
/** Note bodies are edited live, so they are never served stale from cache. */
export const useNote = (id: string) =>
  useQuery({ queryKey: ["note", id], queryFn: () => getNote(id), enabled: !!id, staleTime: 0, gcTime: 0 });
export const useAttachments = (owner: AttachmentOwner) =>
  useQuery({ queryKey: ["attachments", owner.type, owner.id], queryFn: () => listAttachments(owner), enabled: !!owner.id });
export const useContextPdfs = (ctx: { noteId?: string | null; lectureId?: string | null; courseId?: string | null; paperId?: string | null; projectId?: string | null }) =>
  useQuery({ queryKey: ["contextPdfs", ctx.noteId ?? "", ctx.lectureId ?? "", ctx.courseId ?? "", ctx.paperId ?? "", ctx.projectId ?? ""], queryFn: () => listContextPdfs(ctx) });
export const useTemplates = () => useQuery({ queryKey: ["templates"], queryFn: listTemplates });
export const useAllCourses = () => useQuery({ queryKey: ["allCourses"], queryFn: () => listCourses() });

// ------------------------------------------------------------- Phase 3

export const useCalendarItems = (from: string, to: string) =>
  useQuery({ queryKey: ["calendar", from, to], queryFn: () => getCalendarItems(from, to) });
export const useRecurring = () => useQuery({ queryKey: ["recurring"], queryFn: () => listRecurring() });
export const useAllSemesters = () => useQuery({ queryKey: ["allSemesters"], queryFn: listAllSemesters });

// ------------------------------------------------------------- Phase 4

export const useAssignments = (filter: { courseId?: string; open?: boolean } = {}) =>
  useQuery({ queryKey: ["assignments", filter], queryFn: () => listAssignments(filter) });
export const useAssignment = (id: string) => useQuery({ queryKey: ["assignment", id], queryFn: () => getAssignment(id), enabled: !!id });
export const useExams = (filter: { courseId?: string; upcomingFrom?: string } = {}) => useQuery({ queryKey: ["exams", filter], queryFn: () => listExams(filter) });
export const useExam = (id: string) => useQuery({ queryKey: ["exam", id], queryFn: () => getExam(id), enabled: !!id });
export const useCourseStanding = (courseId: string) =>
  useQuery({ queryKey: ["standing", courseId], queryFn: () => getCourseStanding(courseId), enabled: !!courseId });
export const useTasks = (filter: { courseId?: string; projectId?: string; open?: boolean; doneSince?: string } = {}) =>
  useQuery({ queryKey: ["tasks", filter], queryFn: () => listTasks(filter) });
export const useCourseAttendance = (courseId: string) => {
  const today = toDateKey(new Date());
  return useQuery({ queryKey: ["attendance", courseId, today], queryFn: () => getCourseAttendance(courseId, today), enabled: !!courseId });
};
export const useStudySessions = (filter: { since?: string; courseId?: string } = {}) =>
  useQuery({ queryKey: ["sessions", filter], queryFn: () => listStudySessions(filter) });
export const usePerformance = (weekStart: 1 | 7) => useQuery({ queryKey: ["performance", weekStart], queryFn: () => getPerformance(weekStart) });

// ------------------------------------------------------------- Phase 5

export const useTracks = () => useQuery({ queryKey: ["tracks"], queryFn: listTracks });
export const useTrack = (id: string) => useQuery({ queryKey: ["track", id], queryFn: () => getTrack(id), enabled: !!id });
export const useSubjects = (trackId?: string) => useQuery({ queryKey: ["subjects", trackId ?? "all"], queryFn: () => listSubjects(trackId) });
export const useLessons = (filter: { trackId?: string; subjectId?: string } = {}) => useQuery({ queryKey: ["lessons", filter], queryFn: () => listLessons(filter) });
export const useLesson = (id: string) => useQuery({ queryKey: ["lesson", id], queryFn: () => getLesson(id), enabled: !!id });
export const useTopics = () => useQuery({ queryKey: ["topics"], queryFn: listTopics });
export const useQuestions = (filter: QuestionFilter = {}, enabled = true) => useQuery({ queryKey: ["questions", filter], queryFn: () => listQuestions(filter), enabled });
export const useFlashcards = (filter: CardFilter = {}) => useQuery({ queryKey: ["flashcards", filter], queryFn: () => listFlashcards(filter) });
export const useFormulas = (filter: { subject?: string; courseId?: string; search?: string } = {}) => useQuery({ queryKey: ["formulas", filter], queryFn: () => listFormulas(filter) });
export const useDiagnostics = () => useQuery({ queryKey: ["diagnostics"], queryFn: listDiagnostics });
export const useDiagnostic = (id: string) => useQuery({ queryKey: ["diagnostic", id], queryFn: () => getDiagnostic(id), enabled: !!id });
export const useQuizSessions = () => useQuery({ queryKey: ["quizSessions"], queryFn: () => listQuizSessions() });
export const useTopicMastery = () => {
  const today = toDateKey(new Date());
  return useQuery({ queryKey: ["mastery", today], queryFn: () => topicMastery(today) });
};
export const useDueCounts = () => {
  const today = toDateKey(new Date());
  return useQuery({ queryKey: ["dueCounts", today], queryFn: () => dueCounts(today) });
};

// ------------------------------------------------------------- Phase 6

export const useSearch = (text: string, opts: SearchOptions = {}) =>
  useQuery({ queryKey: ["search", text, opts], queryFn: () => search(text, opts), enabled: text.trim().length > 0, placeholderData: (prev) => prev });
export const useTags = () => useQuery({ queryKey: ["tags"], queryFn: listTags });
export const useTagLinks = (type: TaggableType, id: string) => useQuery({ queryKey: ["tagLinks", type, id], queryFn: () => tagLinksFor(type, id), enabled: !!id });
export const useTaggedItems = (tag: string) => useQuery({ queryKey: ["tagged", tag], queryFn: () => itemsWithTag(tag), enabled: !!tag });
export const useEntries = (filter: { courseId?: string; search?: string } = {}) => useQuery({ queryKey: ["entries", filter], queryFn: () => listEntries(filter) });
export const useEntry = (id: string) => useQuery({ queryKey: ["entry", id], queryFn: () => getEntry(id), enabled: !!id });
export const useLinkedItems = (entryId: string) => useQuery({ queryKey: ["linked", entryId], queryFn: () => linkedItems(entryId), enabled: !!entryId });
export const useEntriesFor = (type: LinkTarget, id: string) => useQuery({ queryKey: ["entriesFor", type, id], queryFn: () => entriesFor(type, id), enabled: !!id });

// ------------------------------------------------------------- Phase 7

export const useProjects = (filter: { courseId?: string; status?: ProjectStatus | "open" } = {}) => useQuery({ queryKey: ["projects", filter], queryFn: () => listProjects(filter) });
export const useProject = (id: string) => useQuery({ queryKey: ["project", id], queryFn: () => getProject(id), enabled: !!id });
export const useMilestones = (projectId: string) => useQuery({ queryKey: ["milestones", projectId], queryFn: () => listMilestones(projectId), enabled: !!projectId });
export const useProjectNotes = (projectId: string) => useQuery({ queryKey: ["projectNotes", projectId], queryFn: () => listProjectNotes(projectId), enabled: !!projectId });
export const useProjectForLesson = (lessonId: string) => useQuery({ queryKey: ["projectForLesson", lessonId], queryFn: () => projectForLesson(lessonId), enabled: !!lessonId });
export const usePapers = (filter: PaperFilter = {}) => useQuery({ queryKey: ["papers", filter], queryFn: () => listPapers(filter) });
export const usePaper = (id: string) => useQuery({ queryKey: ["paper", id], queryFn: () => getPaper(id), enabled: !!id });
export const useProjectsForPaper = (paperId: string) => useQuery({ queryKey: ["paperProjects", paperId], queryFn: () => projectsForPaper(paperId), enabled: !!paperId });
