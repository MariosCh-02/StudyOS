import { Link, useSearchParams } from "react-router";
import { ArrowRight, BookOpen, Building2, CalendarRange, GraduationCap, NotebookPen, Target } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, ErrorState, ProgressBar, Spinner, Stat } from "@/components/ui/Feedback";
import { useDashboard, useNotes } from "@/hooks/queries";
import { NoteList } from "@/features/notes/NoteList";
import { TodaySchedule } from "./TodaySchedule";
import { ReviewCard, StudyCard, UpcomingCard } from "./TrackingCards";
import { formatDateRange, greetingFor } from "@/domain/dates";
import { formatGrade } from "@/domain/grading";
import { LABELS } from "@/domain/types";
import type { DashboardData } from "@/services/dashboard";

function Greeting({ name }: { name: string }) {
  const now = new Date();
  const [params, setParams] = useSearchParams();
  return (
    <header className="mb-6">
      {params.get("noClassToday") && (
        <p role="status" className="mb-3 flex items-center justify-between rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">
          No class is on your timetable today, so there is no lecture to start. Start one from a course page instead.
          <button type="button" className="underline" onClick={() => setParams({}, { replace: true })}>
            Dismiss
          </button>
        </p>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">
        {greetingFor(now)}
        {name ? `, ${name}` : ""}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      </p>
    </header>
  );
}

function Onboarding() {
  const steps = [
    { icon: Building2, title: "Add your institution", text: "University, college, school, online provider or certification body." },
    { icon: GraduationCap, title: "Create a programme", text: "Your degree or track, with its grading scale and credit total." },
    { icon: CalendarRange, title: "Add years and semesters", text: "So StudyOS knows what you are studying right now." },
    { icon: BookOpen, title: "Add your courses", text: "Code, credits, lecturer, room and target grade." },
  ];
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Set up your studies</h2>
      <p className="mt-1 text-sm text-muted">Everything in StudyOS hangs off your academic structure. It takes a couple of minutes.</p>
      <ol className="mt-5 grid grid-cols-2 gap-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-lg border border-border p-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
              <s.icon className="size-4" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium">
                {i + 1}. {s.title}
              </p>
              <p className="text-xs text-muted">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <Link
        to="/studies"
        className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-sm font-medium text-accent-fg hover:brightness-110"
      >
        Get started <ArrowRight className="size-4" />
      </Link>
    </Card>
  );
}

function AcademicCard({ data }: { data: DashboardData }) {
  const p = data.programme!;
  const s = data.stats!;
  const scale = p.gradingScale;
  const gap = s.average != null && p.targetGrade != null ? s.average - p.targetGrade : null;
  return (
    <Card>
      <CardHeader
        title="Academic"
        icon={<GraduationCap className="size-3.5" />}
        action={
          <Link to={`/studies/programmes/${p.id}`} className="text-xs text-accent hover:underline">
            Open programme
          </Link>
        }
      />
      <div className="px-4 pb-4">
        <p className="font-medium">{p.name}</p>
        <p className="text-[13px] text-muted">
          {p.institutionName} · {LABELS.programmeLevel[p.level]}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <Stat label="Current average" value={formatGrade(scale, s.average)} sub={`${s.gradedCredits} ${p.creditUnit} graded`} />
          <Stat label="Target" value={formatGrade(scale, p.targetGrade)} sub={p.targetGrade == null ? "Set one in the programme" : undefined} />
          <Stat
            label="Difference"
            value={gap == null ? "—" : `${gap >= 0 ? "+" : ""}${gap.toFixed(scale.decimals)}`}
            sub={gap == null ? undefined : gap >= 0 ? "At or above target" : "Below target"}
          />
        </div>
        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs text-muted">
            <span>Programme progress</span>
            <span className="tabular-nums">
              {s.earnedCredits}
              {p.totalCredits ? ` / ${p.totalCredits}` : ""} {p.creditUnit}
            </span>
          </div>
          {s.progress != null ? (
            <ProgressBar value={s.progress} label="Programme progress" />
          ) : (
            <p className="text-xs text-subtle">Add the credits required to the programme to track progress.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function CurrentCourses({ data }: { data: DashboardData }) {
  const p = data.programme!;
  const sem = data.currentSemester;
  return (
    <Card>
      <CardHeader
        title={sem ? sem.label : "Current courses"}
        icon={<BookOpen className="size-3.5" />}
        action={sem && (sem.startDate || sem.endDate) ? <span className="text-xs text-subtle">{formatDateRange(sem.startDate, sem.endDate)}</span> : undefined}
      />
      {data.currentCourses.length === 0 ? (
        <EmptyState
          compact
          icon={<BookOpen className="size-4" />}
          title="No current courses"
          description={
            <Link to={`/studies/programmes/${p.id}`} className="text-accent hover:underline">
              Add courses to {sem ? sem.label : "your programme"}
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-border pb-1">
          {data.currentCourses.map((c) => (
            <li key={c.id}>
              <Link to={`/studies/courses/${c.id}`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                <span className="size-2 shrink-0 rounded-full" style={{ background: c.color ?? "var(--subtle)" }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm group-hover:text-accent">{c.name}</span>
                  <span className="block truncate text-xs text-subtle">
                    {[c.code, c.lecturer, c.location].filter(Boolean).join(" · ") || LABELS.courseStatus[c.status]}
                  </span>
                </span>
                {c.finalGrade != null ? (
                  <span className="text-sm tabular-nums">{formatGrade(p.gradingScale, c.finalGrade)}</span>
                ) : c.targetGrade != null ? (
                  <Badge>
                    <Target className="mr-1 size-3" /> {formatGrade(p.gradingScale, c.targetGrade)}
                  </Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentNotes() {
  const notes = useNotes({ limit: 5 });
  const list = notes.data ?? [];
  return (
    <Card>
      <CardHeader
        title="Recent notes"
        icon={<NotebookPen className="size-3.5" />}
        action={
          <Link to="/notes" className="text-xs text-accent hover:underline">
            All notes
          </Link>
        }
      />
      {list.length === 0 ? <p className="px-4 pb-4 text-[13px] text-subtle">Notes you write will appear here.</p> : <NoteList notes={list} />}
    </Card>
  );
}

export function DashboardPage() {
  const dashboard = useDashboard();
  if (dashboard.isPending) return <Spinner />;
  if (dashboard.error) return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  const data = dashboard.data;

  return (
    <>
      <Greeting name={data.displayName} />
      {!data.programme ? (
        <Onboarding />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <TodaySchedule />
          <UpcomingCard />
          <AcademicCard data={data} />
          <StudyCard />
          <ReviewCard />
          <CurrentCourses data={data} />
          <RecentNotes />
        </div>
      )}
    </>
  );
}
