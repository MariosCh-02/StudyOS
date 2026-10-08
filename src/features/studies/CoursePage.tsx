import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import clsx from "clsx";
import { BookOpen, Brain, Calculator, CalendarRange, ClipboardList, FolderOpen, GraduationCap, Plus, LayoutDashboard, Mail, MapPin, Pencil, Play, Presentation, StickyNote, Trash2, User } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge, Card, CardHeader, EmptyState, ErrorState, ProgressBar, Spinner, Stat } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useAcademicYears, useCourse, useProgramme, useSemesters } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { LABELS, type Course } from "@/domain/types";
import { formatGrade, isPassing, toPercent } from "@/domain/grading";
import { formatDateRange } from "@/domain/dates";
import { deleteCourse } from "@/services/courses";
import { CourseForm } from "./CourseForm";
import { LecturesTab } from "@/features/lectures/LecturesTab";
import { AssignmentsTab, ExamsTab, GradesTab } from "@/features/assessments/CourseTabs";
import { CoursePracticeTab } from "@/features/practice/CoursePracticeTab";
import { ConceptsCard } from "@/features/knowledge/KnowledgePages";
import { useStartTodaysLecture } from "@/features/lectures/lectureUi";
import { AttachmentList } from "@/features/attachments/AttachmentList";
import { NewNoteMenu } from "@/features/notes/NewNoteMenu";
import { NoteList } from "@/features/notes/NoteList";
import { useNotes, useRecurring } from "@/hooks/queries";
import { RecurringForm } from "@/features/calendar/RecurringForm";
import type { RecurringEvent } from "@/services/calendar";
import { WEEKDAY_SHORT } from "@/domain/time";
import { ExportMenu } from "@/components/ExportMenu";
import { courseExports } from "@/features/export/exportItems";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "lectures", label: "Lectures", icon: Presentation },
  { id: "notes", label: "Notes", icon: StickyNote },
  { id: "assignments", label: "Assignments", icon: ClipboardList },
  { id: "exams", label: "Exams", icon: GraduationCap },
  { id: "grades", label: "Grades", icon: Calculator },
  { id: "practice", label: "Practice", icon: Brain },
  { id: "resources", label: "Resources", icon: FolderOpen },
] as const;
type TabId = (typeof TABS)[number]["id"];

function CourseNotesTab({ courseId }: { courseId: string }) {
  const notes = useNotes({ courseId });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Course notes and lecture notes for this course.</p>
        <NewNoteMenu courseId={courseId} />
      </div>
      <Card>
        {notes.isPending ? (
          <Spinner />
        ) : (notes.data ?? []).length === 0 ? (
          <EmptyState icon={<StickyNote className="size-5" />} title="No notes for this course yet" />
        ) : (
          <NoteList notes={notes.data ?? []} />
        )}
      </Card>
    </div>
  );
}

function CourseTimetableCard({ courseId }: { courseId: string }) {
  const series = useRecurring();
  const [form, setForm] = useState<{ series?: RecurringEvent } | null>(null);
  const list = (series.data ?? []).filter((s) => s.courseId === courseId);
  // Stable identity: the form resets whenever its preset changes.
  const preset = useMemo(() => ({ type: "class" as const, courseId }), [courseId]);
  return (
    <Card>
      <CardHeader
        title="Timetable"
        icon={<CalendarRange className="size-3.5" />}
        action={
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setForm({})}>
            Add time
          </Button>
        }
      />
      {list.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-subtle">No weekly class times yet. Add them to see this course in your calendar and get reminders.</p>
      ) : (
        <ul className="pb-2">
          {list.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setForm({ series: s })} className="w-full px-4 py-1.5 text-left hover:bg-surface-2">
                <span className="block text-sm">
                  {s.weekdays.map((d) => WEEKDAY_SHORT[d - 1]).join(", ")} · {s.startTime}–{s.endTime}
                </span>
                <span className="block text-xs text-subtle">{[s.location, formatDateRange(s.startDate, s.endDate)].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <RecurringForm open={form != null} series={form?.series} preset={form?.series ? undefined : preset} onClose={() => setForm(null)} />
    </Card>
  );
}

function ResourcesTab({ courseId }: { courseId: string }) {
  const navigate = useNavigate();
  return (
    <Card className="p-2">
      <p className="px-2 pt-2 pb-1 text-sm text-muted">Syllabus, readings, past papers and other files for the whole course. Files stay on this computer.</p>
      <AttachmentList owner={{ type: "course", id: courseId }} onView={(a) => navigate(`/files/${a.id}`)} />
    </Card>
  );
}

function Detail({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-subtle">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-subtle">{label}</p>
        <div className="truncate text-sm">{children}</div>
      </div>
    </div>
  );
}

export default function CoursePage() {
  const { courseId = "" } = useParams();
  const navigate = useNavigate();
  const course = useCourse(courseId);
  const programmeId = course.data?.programmeId ?? "";
  const programme = useProgramme(programmeId);
  const semesters = useSemesters(programmeId);
  const years = useAcademicYears(programmeId);
  const [editing, setEditing] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.some((t) => t.id === params.get("tab")) ? (params.get("tab") as TabId) : "overview";
  const startToday = useStartTodaysLecture();
  const remove = useConfirmAction(
    (c: Course) => deleteCourse(c.id),
    (c) => navigate(`/studies/programmes/${c.programmeId}`),
  );

  if (course.isPending) return <Spinner />;
  if (course.error) return <ErrorState error={course.error} onRetry={() => void course.refetch()} />;
  const c = course.data;
  if (!c)
    return (
      <EmptyState
        icon={<BookOpen className="size-5" />}
        title="Course not found"
        description="It may have been deleted."
        action={<Button onClick={() => navigate("/studies")}>Back to My Studies</Button>}
      />
    );
  if (programme.isPending) return <Spinner />;
  if (programme.error || !programme.data) return <ErrorState error={programme.error ?? "Programme not found."} />;

  const p = programme.data;
  const scale = p.gradingScale;
  const semester = semesters.data?.find((s) => s.id === c.semesterId);
  const year = years.data?.find((y) => y.id === semester?.academicYearId);
  const target = c.targetGrade ?? p.targetGrade;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1.5">
            <Link to="/studies" className="hover:text-fg">
              My Studies
            </Link>
            /
            <Link to={`/studies/programmes/${p.id}`} className="hover:text-fg">
              {p.name}
            </Link>
            {semester && (
              <>
                / <span>{year ? `${year.label} · ${semester.label}` : semester.label}</span>
              </>
            )}
          </span>
        }
        title={c.name}
        subtitle={
          <span className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: c.color ?? "var(--subtle)" }} />
            {c.code && <span className="tabular-nums">{c.code}</span>}
            {c.credits != null && (
              <span>
                · {c.credits} {p.creditUnit}
              </span>
            )}
            <Badge tone={c.status === "in_progress" ? "accent" : c.status === "completed" ? "success" : "neutral"}>
              {LABELS.courseStatus[c.status]}
            </Badge>
          </span>
        }
        actions={
          <>
            <Button variant="primary" icon={<Play className="size-4" />} loading={startToday.busy} onClick={() => void startToday.start(c.id)}>
              Start lecture
            </Button>
            <ExportMenu items={courseExports(c.id, c.code ?? c.name)} />
            <IconButton label="Edit course" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Delete course" onClick={() => remove.ask(c)}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        }
      />
      {startToday.error && <p className="-mt-4 mb-4 text-sm text-danger">{startToday.error}</p>}

      <div role="tablist" aria-label="Course sections" className="mb-5 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === "overview" ? {} : { tab: t.id }, { replace: true })}
            className={clsx(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t.id ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            <t.icon className="size-4" aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "lectures" && <LecturesTab course={c} />}
      {tab === "notes" && <CourseNotesTab courseId={c.id} />}
      {tab === "resources" && <ResourcesTab courseId={c.id} />}
      {tab === "assignments" && <AssignmentsTab course={c} />}
      {tab === "exams" && <ExamsTab course={c} />}
      {tab === "grades" && <GradesTab course={c} scale={scale} programmeTarget={p.targetGrade} />}
      {tab === "practice" && <CoursePracticeTab courseId={c.id} courseName={c.name} />}
      {tab === "overview" && (
      <div className="grid grid-cols-[1fr_20rem] items-start gap-6">
        <div className="flex flex-col gap-6">
          <Card className="grid grid-cols-3 gap-6 p-5">
            <Stat
              label="Final grade"
              value={formatGrade(scale, c.finalGrade)}
              sub={c.finalGrade != null ? (isPassing(scale, c.finalGrade) ? "Passed" : "Below pass mark") : "Not graded yet"}
            />
            <Stat
              label="Target"
              value={formatGrade(scale, target)}
              sub={c.targetGrade != null ? "Course target" : target != null ? "Programme target" : "No target set"}
            />
            <div className="flex flex-col justify-center gap-2">
              <span className="text-xs text-muted">Grade vs target</span>
              {c.finalGrade != null && target != null && target > scale.min ? (
                <>
                  <span className="text-sm tabular-nums">
                    {Math.round(toPercent(scale, c.finalGrade))}% of scale · target {Math.round(toPercent(scale, target))}%
                  </span>
                  <ProgressBar value={(c.finalGrade - scale.min) / (target - scale.min)} label="Grade relative to target" />
                </>
              ) : (
                <span className="text-xs text-subtle">Available once a grade and target are set.</span>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="About this course" />
            <div className="px-4 pb-4 text-sm leading-relaxed whitespace-pre-wrap text-muted">
              {c.description ?? "No description. Use Edit to add the syllabus summary, learning outcomes or assessment breakdown."}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-4 p-4">
          <Detail icon={<User className="size-4" />} label="Lecturer">
            {c.lecturer ?? <span className="text-subtle">—</span>}
          </Detail>
          <Detail icon={<Mail className="size-4" />} label="Email">
            {c.lecturerEmail ? (
              <a href={`mailto:${c.lecturerEmail}`} className="text-accent hover:underline">
                {c.lecturerEmail}
              </a>
            ) : (
              <span className="text-subtle">—</span>
            )}
          </Detail>
          <Detail icon={<MapPin className="size-4" />} label="Room / location">
            {c.location ?? <span className="text-subtle">—</span>}
          </Detail>
          <Detail icon={<BookOpen className="size-4" />} label="Semester">
            {semester ? (
              <>
                {semester.label}
                {(semester.startDate || semester.endDate) && (
                  <p className="text-xs text-subtle">{formatDateRange(semester.startDate, semester.endDate)}</p>
                )}
              </>
            ) : (
              <span className="text-subtle">Not assigned</span>
            )}
          </Detail>
        </Card>
        <CourseTimetableCard courseId={c.id} />
        <ConceptsCard type="course" id={c.id} />
        </div>
      </div>

      )}

      <CourseForm open={editing} onClose={() => setEditing(false)} programme={p} course={c} />
      <ConfirmDialog
        open={remove.target != null}
        title="Delete course?"
        busy={remove.busy} error={remove.error}
        onClose={remove.cancel}
        onConfirm={remove.confirm}
        message={
          <>
            <p>
              <strong className="text-fg">{c.name}</strong> will be removed from {p.name}.
            </p>
            {remove.error && <p className="mt-2 text-danger">{remove.error}</p>}
          </>
        }
      />
    </>
  );
}
