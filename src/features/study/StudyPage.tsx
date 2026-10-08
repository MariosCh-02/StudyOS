import { useMemo, useState } from "react";
import clsx from "clsx";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { Flame, Pause, Play, Plus, SkipForward, Square, Timer, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader, EmptyState, Stat } from "@/components/ui/Feedback";
import { ConfirmDialog, FormModal } from "@/components/ui/Modal";
import { SelectField, TextField } from "@/components/ui/Field";
import { useAllCourses, useSaveMutation, useSettings, useStudySessions, useTasks } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { minutesByCourse, studyTotals } from "@/domain/tracking";
import { addDays, dateOf, formatDuration, joinDateTime, nowLocal, timeOf } from "@/domain/time";
import { formatDate } from "@/domain/dates";
import { deleteStudySession, recordStudySession, type StudySession } from "@/services/tracking";
import { formatClock, useTimer } from "./TimerProvider";
import { TIMER_MODES, type TimerMode } from "./timerMachine";

const CHART_DAYS = 14;

function ChartTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  const p = payload?.[0];
  if (!active || !p) return null;
  const row = p.payload as { date: string; minutes: number };
  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg">
      <p className="text-muted">{formatDate(row.date, { weekday: "short", day: "numeric", month: "short" })}</p>
      <p className="font-medium text-fg tabular-nums">{row.minutes ? formatDuration(row.minutes) : "No study"}</p>
    </div>
  );
}

/** Minutes studied per day over the last two weeks (single series, so no legend). */
function DailyChart({ sessions }: { sessions: StudySession[] }) {
  const [asTable, setAsTable] = useState(false);
  const today = dateOf(nowLocal());
  const data = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const s of sessions) byDay.set(dateOf(s.start), (byDay.get(dateOf(s.start)) ?? 0) + s.minutes);
    return Array.from({ length: CHART_DAYS }, (_, i) => {
      const date = addDays(today, i - CHART_DAYS + 1);
      return { date, label: formatDate(date, { day: "numeric", month: "short" }), minutes: byDay.get(date) ?? 0 };
    });
  }, [sessions, today]);

  return (
    <Card>
      <CardHeader
        title="Study time, last 14 days"
        action={
          <button type="button" onClick={() => setAsTable((v) => !v)} className="text-xs text-accent hover:underline">
            {asTable ? "Show chart" : "Show as table"}
          </button>
        }
      />
      {asTable ? (
        <table className="mx-4 mb-4 w-[calc(100%-2rem)] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Minutes</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date} className="border-t border-border">
                <td className="py-1">{formatDate(d.date, { weekday: "short", day: "numeric", month: "short" })}</td>
                <td className="py-1 text-right tabular-nums">{d.minutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="h-48 px-2 pb-3" role="img" aria-label="Bar chart of minutes studied per day over the last 14 days">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fill: "var(--subtle)", fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis width={36} tickLine={false} axisLine={false} tick={{ fill: "var(--subtle)", fontSize: 11 }} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="minutes" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function TimerCard() {
  const timer = useTimer();
  const courses = useAllCourses();
  const tasks = useTasks({ open: true });
  const settings = useSettings();
  const [modeId, setModeId] = useState("25/5");
  const [custom, setCustom] = useState({ focus: "40", break: "8" });
  const [courseId, setCourseId] = useState("");
  const [topic, setTopic] = useState("");
  const [taskId, setTaskId] = useState("");

  const s = timer.state;
  const active = s.status !== "idle";
  const mode: TimerMode | null =
    modeId === "custom"
      ? Number(custom.focus) >= 1 && Number(custom.break) >= 1
        ? { id: `${custom.focus}/${custom.break}`, label: "Custom", focus: Math.round(Number(custom.focus)), break: Math.round(Number(custom.break)) }
        : null
      : (TIMER_MODES.find((m) => m.id === modeId) ?? null);

  const begin = () => {
    if (!mode) return;
    const task = tasks.data?.find((t) => t.id === taskId);
    const cid = courseId || task?.courseId || null;
    timer.start(mode, {
      courseId: cid,
      programmeId: courses.data?.find((c) => c.id === cid)?.programmeId ?? (settings.data?.activeProgrammeId || null),
      topic: topic.trim() || task?.title || null,
      taskId: taskId || null,
    });
  };

  const ctxCourse = active ? courses.data?.find((c) => c.id === s.ctx.courseId) : undefined;

  return (
    <Card className="p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", !active ? "bg-surface-2 text-muted" : s.phase === "focus" ? "bg-accent-soft text-accent" : "bg-success-soft text-success")}>
          {!active ? "Ready" : s.phase === "focus" ? `Focus · block ${s.cycle + 1}` : "Break"}
          {s.status === "paused" && " · paused"}
        </span>
        <p className="text-6xl font-semibold tracking-tight tabular-nums" aria-live="polite">
          {active ? formatClock(timer.remainingMs) : mode ? formatClock(mode.focus * 60_000) : "--:--"}
        </p>
        {active && (
          <p className="text-sm text-muted">
            {[ctxCourse?.name, s.ctx.topic].filter(Boolean).join(" · ") || "General study"} · {s.mode.focus}/{s.mode.break}
          </p>
        )}
      </div>

      {!active ? (
        <div className="mt-6 flex flex-col gap-4">
          <div role="radiogroup" aria-label="Timer mode" className="flex flex-wrap justify-center gap-2">
            {[...TIMER_MODES.map((m) => ({ id: m.id, label: m.label })), { id: "custom", label: "Custom" }].map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={modeId === m.id}
                onClick={() => setModeId(m.id)}
                className={clsx("h-8 rounded-md border px-3 text-sm", modeId === m.id ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-fg")}
              >
                {m.label}
              </button>
            ))}
          </div>
          {modeId === "custom" && (
            <div className="mx-auto grid w-64 grid-cols-2 gap-3">
              <TextField label="Focus (min)" inputMode="numeric" value={custom.focus} onChange={(e) => setCustom({ ...custom, focus: e.target.value })} />
              <TextField label="Break (min)" inputMode="numeric" value={custom.break} onChange={(e) => setCustom({ ...custom, break: e.target.value })} />
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <SelectField
              label="Course"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              options={[{ value: "", label: "None" }, ...(courses.data ?? []).filter((c) => c.status !== "dropped").map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))]}
            />
            <TextField label="Topic" placeholder="e.g. Gradient descent" value={topic} onChange={(e) => setTopic(e.target.value)} />
            <SelectField
              label="Task"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              options={[{ value: "", label: "None" }, ...(tasks.data ?? []).map((t) => ({ value: t.id, label: t.title }))]}
            />
          </div>
          <Button variant="primary" icon={<Play className="size-4" />} disabled={!mode} onClick={begin} className="mx-auto w-48">
            Start
          </Button>
        </div>
      ) : (
        <div className="mt-6 flex justify-center gap-2">
          {s.status === "running" ? (
            <Button icon={<Pause className="size-4" />} onClick={timer.pause}>
              Pause
            </Button>
          ) : (
            <Button variant="primary" icon={<Play className="size-4" />} onClick={timer.resume}>
              Resume
            </Button>
          )}
          {s.phase === "break" && (
            <Button icon={<SkipForward className="size-4" />} onClick={timer.skipBreak}>
              Skip break
            </Button>
          )}
          <Button variant="ghost" icon={<Square className="size-4" />} onClick={timer.stop}>
            Stop
          </Button>
        </div>
      )}
      <p className="mt-4 text-center text-xs text-subtle">Each completed focus block is saved automatically; stopping early saves the minutes you studied.</p>
      {timer.error && <p className="mt-2 text-center text-xs text-danger">{timer.error}</p>}
    </Card>
  );
}

function LogTimeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const courses = useAllCourses();
  const [form, setForm] = useState({ date: dateOf(nowLocal()), time: "18:00", minutes: "60", courseId: "", topic: "" });
  const save = useSaveMutation(
    () =>
      recordStudySession({
        start: joinDateTime(form.date, form.time),
        minutes: Math.round(Number(form.minutes)),
        kind: "manual",
        mode: null,
        programmeId: courses.data?.find((c) => c.id === form.courseId)?.programmeId ?? null,
        courseId: form.courseId || null,
        lectureId: null,
        taskId: null,
        topic: form.topic,
        notes: null,
      }),
    onClose,
  );
  return (
    <FormModal open={open} onClose={onClose} title="Log study time" submitLabel="Save" submitting={save.isPending} formError={save.formError} onSubmit={() => save.mutate(undefined)}>
      <div className="grid grid-cols-3 gap-3">
        <TextField label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} error={save.fieldErrors.start} />
        <TextField label="Start" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
        <TextField label="Minutes" inputMode="numeric" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} error={save.fieldErrors.minutes} />
      </div>
      <SelectField
        label="Course"
        value={form.courseId}
        onChange={(e) => setForm({ ...form, courseId: e.target.value })}
        options={[{ value: "", label: "None" }, ...(courses.data ?? []).map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))]}
      />
      <TextField label="Topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
    </FormModal>
  );
}

const KIND_LABEL = { timer: "Timer", lecture: "Lecture", manual: "Logged" } as const;

export default function StudyPage() {
  const sessions = useStudySessions();
  const courses = useAllCourses();
  const settings = useSettings();
  const [logging, setLogging] = useState(false);
  const remove = useConfirmAction((s: StudySession) => deleteStudySession(s.id));
  const list = sessions.data ?? [];
  const totals = studyTotals(list, nowLocal(), settings.data?.weekStart === "sunday" ? 7 : 1);
  const monthStart = `${dateOf(nowLocal()).slice(0, 7)}-01`;
  const byCourse = [...minutesByCourse(list.filter((s) => s.start >= monthStart))].sort((a, b) => b[1] - a[1]);
  const courseName = (id: string | null) => (id ? (courses.data?.find((c) => c.id === id)?.name ?? "Removed course") : "No course");

  return (
    <>
      <PageHeader
        title="Study"
        subtitle="Focus timer and study time. Lecture Mode sessions are counted too."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setLogging(true)}>
            Log time
          </Button>
        }
      />
      <div className="grid grid-cols-[1fr_20rem] items-start gap-6">
        <div className="flex flex-col gap-6">
          <TimerCard />
          <DailyChart sessions={list} />
        </div>
        <div className="flex flex-col gap-4">
          <Card className="grid grid-cols-2 gap-5 p-5">
            <Stat label="Today" value={formatDuration(totals.today)} />
            <Stat label="This week" value={formatDuration(totals.week)} />
            <Stat label="This month" value={formatDuration(totals.month)} />
            <Stat label="Total" value={formatDuration(totals.total)} />
            <div className="col-span-2 flex items-center gap-2 text-sm text-muted">
              <Flame className={clsx("size-4", totals.streak ? "text-warning" : "text-subtle")} aria-hidden />
              {totals.streak ? `${totals.streak}-day streak` : "No current streak"} · {totals.activeDays14} of the last 14 days
            </div>
          </Card>
          <Card>
            <CardHeader title="This month by course" />
            {byCourse.length === 0 ? (
              <p className="px-4 pb-4 text-[13px] text-subtle">No study time this month yet.</p>
            ) : (
              <ul className="px-4 pb-3 text-sm">
                {byCourse.map(([id, minutes]) => (
                  <li key={id ?? "none"} className="flex justify-between py-1">
                    <span className="truncate">{courseName(id)}</span>
                    <span className="text-muted tabular-nums">{formatDuration(minutes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Recent sessions" icon={<Timer className="size-3.5" />} />
            {list.length === 0 ? (
              <EmptyState compact icon={<Timer className="size-4" />} title="No sessions yet" description="Start the timer or a lecture to begin tracking." />
            ) : (
              <ul className="max-h-96 divide-y divide-border overflow-y-auto">
                {list.slice(0, 40).map((s) => (
                  <li key={s.id} className="group flex items-center gap-2 px-4 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{s.topic ?? s.courseName ?? "Study"}</p>
                      <p className="truncate text-xs text-subtle">
                        {formatDate(dateOf(s.start), { day: "numeric", month: "short" })} {timeOf(s.start)} · {KIND_LABEL[s.kind]}
                        {s.courseName && s.topic ? ` · ${s.courseName}` : ""}
                      </p>
                    </div>
                    <span className="text-xs text-muted tabular-nums">{formatDuration(s.minutes)}</span>
                    <IconButton label="Delete session" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => remove.ask(s)}>
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <LogTimeDialog open={logging} onClose={() => setLogging(false)} />
      <ConfirmDialog
        open={remove.target != null}
        title="Delete session?"
        busy={remove.busy} error={remove.error}
        onClose={remove.cancel}
        onConfirm={remove.confirm}
        message={remove.target && <p>{formatDuration(remove.target.minutes)} on {formatDate(dateOf(remove.target.start))} will be removed from your totals.</p>}
      />
    </>
  );
}
