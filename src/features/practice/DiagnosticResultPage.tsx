import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarPlus, CheckCircle2, Play, TrendingDown, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, ErrorState, ProgressBar, Spinner, Stat } from "@/components/ui/Feedback";
import { SelectField, TextField } from "@/components/ui/Field";
import { useLessons } from "@/hooks/queries";
import { planRevision, type PlannedSession } from "@/domain/planner";
import { addDays, dateOf, nowLocal, timeOf } from "@/domain/time";
import { formatDate } from "@/domain/dates";
import { createEvent, getCalendarItems } from "@/services/calendar";
import { LEVEL_LABELS } from "@/services/learning";
import { listQuizSessions, sessionBreakdown, type AreaScore, type QuizSessionSummary } from "@/services/practice";

const STRONG = 75;
const WEAK = 50;

function AreaList({ items }: { items: AreaScore[] }) {
  return (
    <ul className="space-y-3 px-4 pb-4">
      {items.map((a) => (
        <li key={a.key}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5">
              {a.percent >= STRONG ? <TrendingUp className="size-3.5 text-success" aria-label="Strong" /> : a.percent < WEAK ? <TrendingDown className="size-3.5 text-danger" aria-label="Weak" /> : null}
              {a.name}
            </span>
            <span className={clsx("tabular-nums", a.percent >= STRONG ? "text-success" : a.percent < WEAK ? "text-danger" : "text-muted")}>
              {Math.round(a.percent)}% <span className="text-xs text-subtle">({a.correct % 1 ? a.correct.toFixed(1) : a.correct}/{a.total})</span>
            </span>
          </div>
          <ProgressBar value={a.percent / 100} label={`${a.name} score`} />
        </li>
      ))}
    </ul>
  );
}

export default function DiagnosticResultPage() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [session, setSession] = useState<QuizSessionSummary | null>(null);
  const [breakdown, setBreakdown] = useState<{ bySubject: AreaScore[]; byTopic: AreaScore[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const lessons = useLessons();
  const [until, setUntil] = useState(addDays(dateOf(nowLocal()), 28));
  const [perDay, setPerDay] = useState("1");
  const [plan, setPlan] = useState<PlannedSession[] | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [added, setAdded] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const s = (await listQuizSessions(500)).find((x) => x.id === sessionId) ?? null;
        setSession(s);
        setBreakdown(await sessionBreakdown(sessionId));
      } catch (err) {
        setError(err);
      }
    })();
  }, [sessionId]);

  // Recommended lessons: unfinished lessons in the weakest subjects, foundations first.
  const recommended = useMemo(() => {
    if (!breakdown) return [];
    const weakSubjects = breakdown.bySubject.filter((s) => s.percent < STRONG);
    const rank = new Map(weakSubjects.map((s, i) => [s.key, i]));
    return (lessons.data ?? [])
      .filter((l) => rank.has(l.subjectId) && !l.completedAt)
      .sort((a, b) => rank.get(a.subjectId)! - rank.get(b.subjectId)! || a.level - b.level || a.sortOrder - b.sortOrder)
      .slice(0, 12);
  }, [breakdown, lessons.data]);

  if (error) return <ErrorState error={error} />;
  if (!breakdown) return <Spinner />;

  const total = breakdown.bySubject.reduce((n, s) => n + s.total, 0);
  const score = session?.score ?? (total ? breakdown.bySubject.reduce((n, s) => n + s.correct, 0) / total : 0);
  const strong = breakdown.bySubject.filter((s) => s.percent >= STRONG);
  const weak = breakdown.bySubject.filter((s) => s.percent < WEAK);
  const weakTopics = breakdown.byTopic.filter((t) => t.percent < STRONG && t.key !== "none");

  const suggest = async () => {
    setPlanBusy(true);
    try {
      const from = addDays(dateOf(nowLocal()), 1);
      const busy = await getCalendarItems(from, until);
      const topics = (weakTopics.length ? weakTopics : breakdown.bySubject.filter((s) => s.percent < STRONG)).map((t) => ({ name: t.name, weight: Math.max(1, Math.round((100 - t.percent) / 25)) }));
      setPlan(planRevision({ topics, from, examDate: addDays(until, 1), busy, sessionMinutes: 60, maxSessionsPerDay: Number(perDay), dayStart: "09:00", dayEnd: "21:00" }));
    } finally {
      setPlanBusy(false);
    }
  };

  const addPlan = async () => {
    if (!plan) return;
    setPlanBusy(true);
    try {
      for (const s of plan) await createEvent({ type: "study", title: `Study: ${s.topic}`, start: s.start, end: s.end, allDay: false, courseId: null, location: null, notes: `From diagnostic: ${session?.title ?? ""}` });
      await client.invalidateQueries();
      setAdded(plan.length);
    } finally {
      setPlanBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/practice?tab=diagnostics" className="hover:text-fg">
            Practice / Diagnostics
          </Link>
        }
        title={`Results: ${session?.title ?? "Diagnostic"}`}
        subtitle={session ? formatDate(dateOf(session.startedAt), { day: "numeric", month: "long", year: "numeric" }) : undefined}
      />
      <Card className="mb-6 grid grid-cols-4 gap-6 p-5">
        <Stat label="Overall" value={`${Math.round(score * 100)}%`} sub={`${total} questions`} />
        <Stat label="Strong areas" value={strong.length} sub={strong.map((s) => s.name).join(", ") || "—"} />
        <Stat label="Weak areas" value={weak.length} sub={weak.map((s) => s.name).join(", ") || "—"} />
        <Stat label="Topics to work on" value={weakTopics.length} />
      </Card>

      <div className="grid grid-cols-2 items-start gap-6">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="By subject" />
            <AreaList items={[...breakdown.bySubject].sort((a, b) => b.percent - a.percent)} />
          </Card>
          <Card>
            <CardHeader title="By topic (weakest first)" />
            <AreaList items={breakdown.byTopic.filter((t) => t.key !== "none")} />
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Your study plan" />
            {recommended.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted">{weak.length || weakTopics.length ? "No unfinished lessons in your weaker subjects. Practise the weak topics below." : "Strong result across the board. Move on to Advanced and Challenge lessons."}</p>
            ) : (
              <ol className="list-decimal space-y-1.5 pr-4 pb-4 pl-9 text-sm">
                {recommended.map((l) => (
                  <li key={l.id}>
                    <Link to={`/practice/lessons/${l.id}`} className="hover:text-accent">
                      {l.title}
                    </Link>{" "}
                    <span className="text-xs text-subtle">
                      {l.subjectName} · {LEVEL_LABELS[l.level]}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {weakTopics.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
                {weakTopics.slice(0, 6).map((t) => (
                  <Button key={t.key} size="sm" icon={<Play className="size-3.5" />} onClick={() => navigate(`/practice/quiz?topic=${t.key}&title=${encodeURIComponent(t.name)}`)}>
                    {t.name}
                  </Button>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Put it in your calendar" icon={<CalendarPlus className="size-3.5" />} />
            <div className="flex flex-col gap-3 px-4 pb-4">
              {added != null ? (
                <p className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 className="size-4" /> Added {added} study sessions. Adjust them in the calendar.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <TextField label="Plan until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
                    <SelectField label="Sessions per day" value={perDay} onChange={(e) => setPerDay(e.target.value)} options={["1", "2", "3"].map((n) => ({ value: n, label: n }))} />
                  </div>
                  <p className="text-xs text-subtle">One-hour sessions in free time between your classes and work, with weaker topics scheduled more often.</p>
                  <Button loading={planBusy} onClick={() => void suggest()}>
                    Suggest sessions
                  </Button>
                  {plan && plan.length === 0 && <p className="text-sm text-warning">No free time found in that period.</p>}
                  {plan && plan.length > 0 && (
                    <>
                      <ul className="max-h-56 overflow-y-auto rounded-md border border-border text-sm">
                        {plan.map((s) => (
                          <li key={s.start} className="flex gap-3 border-b border-border px-3 py-1.5 last:border-0">
                            <span className="w-32 text-xs text-muted tabular-nums">
                              {formatDate(dateOf(s.start), { weekday: "short", day: "numeric", month: "short" })} {timeOf(s.start)}
                            </span>
                            <span className="truncate">{s.topic}</span>
                          </li>
                        ))}
                      </ul>
                      <Button variant="primary" loading={planBusy} onClick={() => void addPlan()}>
                        Add {plan.length} sessions to calendar
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
