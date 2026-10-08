import { useMemo } from "react";
import { Link } from "react-router";
import { AlertTriangle, Brain, CalendarClock, Flame, Layers, Timer } from "lucide-react";
import { Card, CardHeader, Stat } from "@/components/ui/Feedback";
import { useAssignments, useDueCounts, useExams, useSettings, useStudySessions, useTasks, useTopicMastery } from "@/hooks/queries";
import { ProgressBar } from "@/components/ui/Feedback";
import { daysUntil, deadlineClashes, studyTotals } from "@/domain/tracking";
import { addDays, dateOf, formatDuration, nowLocal } from "@/domain/time";
import { formatDate } from "@/domain/dates";
import { useTimer, formatClock } from "@/features/study/TimerProvider";
import { TaskList } from "@/features/tasks/TaskList";

const HORIZON_DAYS = 21;

/** UPCOMING: assignment deadlines and exam countdowns for the next three weeks. */
export function UpcomingCard() {
  const today = dateOf(nowLocal());
  const assignments = useAssignments({ open: true });
  const exams = useExams({ upcomingFrom: `${today}T00:00` });
  const now = nowLocal();
  const horizon = `${addDays(today, HORIZON_DAYS)}T23:59`;

  const items = useMemo(
    () =>
      [
        ...(assignments.data ?? [])
          .filter((a) => a.dueAt && a.dueAt <= horizon)
          .map((a) => ({ key: `a:${a.id}`, href: `/studies/assignments/${a.id}`, kind: "Assignment", title: a.title, course: a.courseCode ?? a.courseName, due: a.dueAt!, color: a.courseColor })),
        ...(exams.data ?? [])
          .filter((e) => e.startAt && e.startAt <= horizon && e.score == null)
          .map((e) => ({ key: `e:${e.id}`, href: `/studies/exams/${e.id}`, kind: "Exam", title: e.title, course: e.courseCode ?? e.courseName, due: e.startAt!, color: e.courseColor })),
      ].sort((a, b) => a.due.localeCompare(b.due)),
    [assignments.data, exams.data, horizon],
  );
  const clashes = deadlineClashes(items);

  return (
    <Card>
      <CardHeader title="Upcoming" icon={<CalendarClock className="size-3.5" />} />
      {items.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-subtle">No deadlines or exams in the next {HORIZON_DAYS} days.</p>
      ) : (
        <>
          {clashes.length > 0 && (
            <p className="mx-4 mb-2 flex items-center gap-1.5 rounded-md bg-warning-soft px-3 py-1.5 text-xs text-warning">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              {clashes[0]![0].title} and {clashes[0]![1].title} are due within 24 hours of each other.
            </p>
          )}
          <ul className="pb-1">
            {items.slice(0, 6).map((i) => {
              const days = daysUntil(i.due, now);
              const overdue = i.due < now;
              return (
                <li key={i.key}>
                  <Link to={i.href} className="group flex items-center gap-3 px-4 py-2 hover:bg-surface-2">
                    <span className="h-7 w-1 shrink-0 rounded-full" style={{ background: i.color ?? "var(--subtle)" }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm group-hover:text-accent">{i.title}</span>
                      <span className="block text-xs text-subtle">
                        {i.kind} · {i.course} · {formatDate(dateOf(i.due), { weekday: "short", day: "numeric", month: "short" })}
                      </span>
                    </span>
                    <span className={`text-right text-xs font-medium tabular-nums ${overdue ? "text-danger" : days <= 3 ? "text-warning" : "text-muted"}`}>
                      {overdue ? "Overdue" : days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days} days`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

/** STUDY: time studied, streak, the running timer and the next tasks. */
export function StudyCard() {
  const settings = useSettings();
  const since = addDays(dateOf(nowLocal()), -40);
  const sessions = useStudySessions({ since });
  const tasks = useTasks({ open: true });
  const timer = useTimer();
  const totals = studyTotals(sessions.data ?? [], nowLocal(), settings.data?.weekStart === "sunday" ? 7 : 1);
  const next = (tasks.data ?? []).slice(0, 3);

  return (
    <Card>
      <CardHeader
        title="Study"
        icon={<Timer className="size-3.5" />}
        action={
          <Link to="/study" className="text-xs text-accent hover:underline">
            {timer.state.status === "idle" ? "Start timer" : `${timer.state.phase === "focus" ? "Focus" : "Break"} ${formatClock(timer.remainingMs)}`}
          </Link>
        }
      />
      <div className="grid grid-cols-3 gap-4 px-4 pb-3">
        <Stat label="Today" value={formatDuration(totals.today)} />
        <Stat label="This week" value={formatDuration(totals.week)} />
        <Stat
          label="Streak"
          value={
            <span className="flex items-center gap-1">
              <Flame className={totals.streak ? "size-4 text-warning" : "size-4 text-subtle"} aria-hidden />
              {totals.streak} d
            </span>
          }
        />
      </div>
      <div className="border-t border-border">
        <div className="flex items-center justify-between px-4 pt-2 text-xs text-muted">
          <span>Next tasks</span>
          <Link to="/tasks" className="text-accent hover:underline">
            All tasks
          </Link>
        </div>
        {next.length === 0 ? <p className="px-4 pt-1 pb-3 text-[13px] text-subtle">No open tasks.</p> : <TaskList tasks={next} />}
      </div>
    </Card>
  );
}

/** STUDY (review): flashcards and questions due, and the topics needing revision. */
export function ReviewCard() {
  const due = useDueCounts();
  const mastery = useTopicMastery();
  const weakest = (mastery.data ?? []).filter((m) => m.mastery != null && m.mastery < 70).slice(0, 3);
  const cards = (due.data?.cardsDue ?? 0) + Math.min(due.data?.cardsNew ?? 0, 20);
  const questions = due.data?.questionsDue ?? 0;
  return (
    <Card>
      <CardHeader title="Review" icon={<Brain className="size-3.5" />} action={<Link to="/practice?tab=mastery" className="text-xs text-accent hover:underline">Mastery</Link>} />
      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <Link to="/flashcards/review" className="rounded-lg border border-border p-3 hover:border-accent/60">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Layers className="size-3.5" aria-hidden /> Flashcards due
          </p>
          <p className="text-xl font-semibold tabular-nums">{cards}</p>
        </Link>
        <Link to="/practice/quiz?due=1&kind=review&count=all&title=Review%20due%20questions" className="rounded-lg border border-border p-3 hover:border-accent/60">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Brain className="size-3.5" aria-hidden /> Questions due
          </p>
          <p className="text-xl font-semibold tabular-nums">{questions}</p>
        </Link>
      </div>
      <div className="border-t border-border px-4 py-3">
        <p className="mb-2 text-xs text-muted">Topics needing revision</p>
        {weakest.length === 0 ? (
          <p className="text-[13px] text-subtle">{(mastery.data ?? []).length ? "No weak topics right now." : "Practise to see topic mastery here."}</p>
        ) : (
          <ul className="space-y-2">
            {weakest.map((m) => (
              <li key={m.topicId}>
                <Link to={`/practice/quiz?topic=${m.topicId}&title=${encodeURIComponent(m.name)}`} className="block hover:text-accent">
                  <span className="mb-0.5 flex justify-between text-sm">
                    <span className="truncate">{m.name}</span>
                    <span className="text-xs text-muted tabular-nums">{m.mastery}%</span>
                  </span>
                  <ProgressBar value={(m.mastery ?? 0) / 100} label={`${m.name} mastery`} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
