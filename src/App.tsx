import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AppShell } from "@/components/layout/AppShell";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";
import { Spinner } from "@/components/ui/Feedback";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { ReminderService } from "@/features/calendar/ReminderService";
import { TimerProvider } from "@/features/study/TimerProvider";
import { CommandPalette } from "@/features/search/CommandPalette";
import { BackupService } from "@/features/settings/BackupService";
import { DesktopIntegration } from "@/features/settings/DesktopIntegration";

// Secondary screens are code-split so startup only loads the dashboard.
const StudiesPage = lazy(() => import("@/features/studies/StudiesPage"));
const ProgrammePage = lazy(() => import("@/features/studies/ProgrammePage"));
const CoursePage = lazy(() => import("@/features/studies/CoursePage"));
const LecturePage = lazy(() => import("@/features/lectures/LecturePage"));
const LectureMode = lazy(() => import("@/features/lectures/LectureMode"));
const NotesPage = lazy(() => import("@/features/notes/NotesPage"));
const NoteEditorPage = lazy(() => import("@/features/notes/NoteEditorPage"));
const FileViewerPage = lazy(() => import("@/features/attachments/FileViewerPage"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));
const CalendarPage = lazy(() => import("@/features/calendar/CalendarPage"));
const TimetablePage = lazy(() => import("@/features/calendar/TimetablePage"));
const TasksPage = lazy(() => import("@/features/tasks/TasksPage"));
const StudyPage = lazy(() => import("@/features/study/StudyPage"));
const GradesPage = lazy(() => import("@/features/performance/GradesPage"));
const AssignmentPage = lazy(() => import("@/features/assessments/AssignmentPage"));
const ExamPage = lazy(() => import("@/features/assessments/ExamPage"));
const PracticePage = lazy(() => import("@/features/practice/PracticePage"));
const QuizPage = lazy(() => import("@/features/practice/QuizPage"));
const TrackPage = lazy(() => import("@/features/practice/TrackPage"));
const LessonPage = lazy(() => import("@/features/practice/LessonPage"));
const DiagnosticResultPage = lazy(() => import("@/features/practice/DiagnosticResultPage"));
const FlashcardsPage = lazy(() => import("@/features/flashcards/FlashcardsPage"));
const SearchPage = lazy(() => import("@/features/search/SearchPage"));
const AskPage = lazy(() => import("@/features/ask/AskPage"));
const FilesPage = lazy(() => import("@/features/files/FilesPage"));
const KnowledgePage = lazy(() => import("@/features/knowledge/KnowledgePages"));
const ConceptPage = lazy(() => import("@/features/knowledge/KnowledgePages").then((m) => ({ default: m.ConceptPage })));
const ProjectsPage = lazy(() => import("@/features/projects/ProjectsPage"));
const ProjectPage = lazy(() => import("@/features/projects/ProjectPage"));
const PapersPage = lazy(() => import("@/features/papers/PapersPage"));
const PaperPage = lazy(() => import("@/features/papers/PaperPage"));
const FlashcardReviewPage = lazy(() => import("@/features/flashcards/FlashcardsPage").then((m) => ({ default: m.FlashcardReviewPage })));

const page = (el: ReactNode) => <Suspense fallback={<Spinner />}>{el}</Suspense>;

export function App() {
  return (
    <TimerProvider>
    <ReminderService />
    <BackupService />
    <DesktopIntegration />
    <CommandPalette />
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="studies" element={page(<StudiesPage />)} />
        <Route path="studies/programmes/:programmeId" element={page(<ProgrammePage />)} />
        <Route path="studies/courses/:courseId" element={page(<CoursePage />)} />
        <Route path="studies/lectures/:lectureId" element={page(<LecturePage />)} />
        <Route path="notes" element={page(<NotesPage />)} />
        <Route path="timetable" element={page(<TimetablePage />)} />
        <Route path="tasks" element={page(<TasksPage />)} />
        <Route path="study" element={page(<StudyPage />)} />
        <Route path="grades" element={page(<GradesPage />)} />
        <Route path="studies/assignments/:assignmentId" element={page(<AssignmentPage />)} />
        <Route path="studies/exams/:examId" element={page(<ExamPage />)} />
        <Route path="practice" element={page(<PracticePage />)} />
        <Route path="practice/quiz" element={page(<QuizPage />)} />
        <Route path="practice/tracks/:trackId" element={page(<TrackPage />)} />
        <Route path="practice/lessons/:lessonId" element={page(<LessonPage />)} />
        <Route path="practice/diagnostics/results/:sessionId" element={page(<DiagnosticResultPage />)} />
        <Route path="flashcards" element={page(<FlashcardsPage />)} />
        <Route path="flashcards/review" element={page(<FlashcardReviewPage />)} />
        <Route path="search" element={page(<SearchPage />)} />
        <Route path="ask" element={page(<AskPage />)} />
        <Route path="files" element={page(<FilesPage />)} />
        <Route path="knowledge" element={page(<KnowledgePage />)} />
        <Route path="knowledge/:entryId" element={page(<ConceptPage />)} />
        <Route path="projects" element={page(<ProjectsPage />)} />
        <Route path="projects/:projectId" element={page(<ProjectPage />)} />
        <Route path="papers" element={page(<PapersPage />)} />
        <Route path="papers/:paperId" element={page(<PaperPage />)} />
        <Route path="settings" element={page(<SettingsPage />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      {/* Editor-style screens use the full content area. */}
      <Route element={<AppShell fullBleed />}>
        <Route path="notes/:noteId" element={page(<NoteEditorPage />)} />
        <Route path="files/:attachmentId" element={page(<FileViewerPage />)} />
        <Route path="calendar" element={page(<CalendarPage />)} />
      </Route>
      {/* Quick Lecture Mode hides the sidebar for focus. */}
      <Route path="lecture/:lectureId" element={<PageErrorBoundary resetKey="lecture">{page(<LectureMode />)}</PageErrorBoundary>} />
    </Routes>
    </TimerProvider>
  );
}
