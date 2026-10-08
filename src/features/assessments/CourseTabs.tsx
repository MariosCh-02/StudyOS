import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, CalendarClock, ClipboardList, GraduationCap, Plus, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, EmptyState, Spinner, Stat } from "@/components/ui/Feedback";
import { useAssignments, useCourseAttendance, useCourseStanding, useExams } from "@/hooks/queries";
import { DEFAULT_TARGETS, requiredFor, type Requirement } from "@/domain/assessment";
import { formatGrade, percentToScale, toPercent, type GradingScale } from "@/domain/grading";
import { daysUntil, describeDue, type AttendanceStatus } from "@/domain/tracking";
import { dateOf, nowLocal, timeOf } from "@/domain/time";
import { formatDate } from "@/domain/dates";
import type { Course } from "@/domain/types";
import { ASSESSMENT_LABELS } from "@/services/assessments";
import { updateCourse } from "@/services/courses";
import { clearAttendance, recordAttendance } from "@/services/tracking";
import { AssignmentForm, ExamForm } from "./AssessmentForms";

const STATUS_TONE = { not_started: "neutral", in_progress: "accent", submitted: "warning", graded: "success" } as const;
const pctText = (p: number | null) => (p == null ? "—" : `${p.toFixed(1)}%`);

export function AssignmentsTab({ course }: { course: Course }) {
  const assignments = useAssignments({ courseId: course.id });
  const [creating, setCreating] = useState(false);
  const now = nowLocal();
  if (assignments.isPending) return <Spinner />;
  const list = assignments.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          New assignment
        </Button>
      </div>
      <Card>
        {list.length === 0 ? (
          <EmptyState icon={<ClipboardList className="size-5" />} title="No assignments yet" description="Add coursework with its due date and weight. Deadlines appear on your calendar and count towards the grade calculator." />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((a) => {
              const overdue = a.dueAt && a.dueAt < now && (a.status === "not_started" || a.status === "in_progress");
              const done = a.checklist.filter((c) => c.done).length;
              return (
                <li key={a.id}>
                  <Link to={`/studies/assignments/${a.id}`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm group-hover:text-accent">{a.title}</p>
                      <p className="text-xs text-subtle">
                        {ASSESSMENT_LABELS.assignmentKind[a.kind]}
                        {a.dueAt && (
                          <span className={overdue ? "text-danger" : undefined}>
                            {" "}· {formatDate(dateOf(a.dueAt), { day: "numeric", month: "short" })} {timeOf(a.dueAt)}
                            {a.status !== "graded" && a.status !== "submitted" && ` (${describeDue(a.dueAt, now)})`}
                          </span>
                        )}
                        {a.checklist.length > 0 && ` · ${done}/${a.checklist.length} steps`}
                      </p>
                    </div>
                    <span className="w-14 text-right text-xs text-muted tabular-nums">{a.weight != null ? `${a.weight}%` : ""}</span>
                    <span className="w-16 text-right text-sm tabular-nums">{a.score != null && a.maxScore ? `${a.score}/${a.maxScore}` : ""}</span>
                    <span className="w-24 text-right">
                      <Badge tone={STATUS_TONE[a.status]}>{ASSESSMENT_LABELS.assignmentStatus[a.status]}</Badge>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <AssignmentForm open={creating} onClose={() => setCreating(false)} courseId={course.id} />
    </div>
  );
}

export function ExamsTab({ course }: { course: Course }) {
  const exams = useExams({ courseId: course.id });
  const [creating, setCreating] = useState(false);
  const now = nowLocal();
  if (exams.isPending) return <Spinner />;
  const list = exams.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          New exam
        </Button>
      </div>
      <Card>
        {list.length === 0 ? (
          <EmptyState icon={<GraduationCap className="size-5" />} title="No exams yet" description="Add midterms and finals with date, time and topics. Each exam gets a countdown, a revision checklist and a study planner." />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((e) => {
              const days = e.startAt ? daysUntil(e.startAt, now) : null;
              return (
                <li key={e.id}>
                  <Link to={`/studies/exams/${e.id}`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <div className="w-16 shrink-0 text-center">
                      {days != null && days >= 0 && e.score == null ? (
                        <>
                          <p className="text-xl font-semibold tabular-nums">{days}</p>
                          <p className="text-[10px] text-subtle uppercase">{days === 1 ? "day" : "days"}</p>
                        </>
                      ) : (
                        <CalendarClock className="mx-auto size-4 text-subtle" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm group-hover:text-accent">{e.title}</p>
                      <p className="text-xs text-subtle">
                        {ASSESSMENT_LABELS.examKind[e.kind]}
                        {e.startAt && ` · ${formatDate(dateOf(e.startAt), { weekday: "short", day: "numeric", month: "short" })} ${timeOf(e.startAt)}`}
                        {e.location && ` · ${e.location}`}
                        {e.topics.length > 0 && ` · ${e.topics.filter((t) => t.done).length}/${e.topics.length} topics revised`}
                      </p>
                    </div>
                    <span className="w-14 text-right text-xs text-muted tabular-nums">{e.weight != null ? `${e.weight}%` : ""}</span>
                    <span className="w-16 text-right text-sm tabular-nums">{e.score != null && e.maxScore ? `${e.score}/${e.maxScore}` : ""}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <ExamForm open={creating} onClose={() => setCreating(false)} courseId={course.id} />
    </div>
  );
}

function RequirementCell({ r }: { r: Requirement }) {
  switch (r.status) {
    case "secured":
      return <span className="text-success">Already secured</span>;
    case "possible":
      return <span className="tabular-nums">{r.required.toFixed(1)}% average on the rest</span>;
    case "impossible":
      return <span className="text-subtle">Not reachable (best possible {r.best.toFixed(1)}%)</span>;
    case "complete":
      return <span className="text-subtle">All graded: {r.final.toFixed(1)}%</span>;
    default:
      return <span className="text-subtle">Add weights to calculate</span>;
  }
}

const ATTENDANCE_OPTIONS: { value: AttendanceStatus; label: string; tone: string }[] = [
  { value: "present", label: "Present", tone: "bg-success text-white" },
  { value: "late", label: "Late", tone: "bg-warning text-white" },
  { value: "absent", label: "Absent", tone: "bg-danger text-white" },
  { value: "excused", label: "Excused", tone: "bg-surface-2 text-fg" },
];

function AttendanceCard({ course }: { course: Course }) {
  const client = useQueryClient();
  const att = useCourseAttendance(course.id);
  const today = dateOf(nowLocal());
  if (att.isPending || !att.data) return null;
  const { records, scheduled, stats } = att.data;
  const latest = new Map<string, AttendanceStatus>();
  for (const r of records) latest.set(r.date, r.status);
  const dates = [...new Set([...scheduled, ...records.map((r) => r.date)])].sort().reverse();

  const set = async (date: string, status: AttendanceStatus | null) => {
    if (status) await recordAttendance(course.id, date, status);
    else await clearAttendance(course.id, date);
    await client.invalidateQueries();
  };

  return (
    <Card>
      <CardHeader
        title="Attendance"
        icon={<UserCheck className="size-3.5" />}
        action={
          !latest.has(today) && (
            <Button size="sm" variant="ghost" onClick={() => void set(today, "present")}>
              I'm here today
            </Button>
          )
        }
      />
      <div className="flex gap-6 px-4 pb-3">
        <Stat label="Attendance" value={stats.rate != null ? `${Math.round(stats.rate * 100)}%` : "—"} />
        <Stat label="Present / late" value={`${stats.present} / ${stats.late}`} />
        <Stat label="Absent" value={stats.absent} />
        <Stat label="Unmarked" value={stats.unmarked} sub={scheduled.length ? undefined : "Add class times to track"} />
      </div>
      {dates.length > 0 && (
        <ul className="max-h-72 divide-y divide-border overflow-y-auto border-t border-border">
          {dates.map((d) => {
            const s = latest.get(d);
            return (
              <li key={d} className="flex items-center gap-3 px-4 py-1.5 text-sm">
                <span className="flex-1">{formatDate(d, { weekday: "short", day: "numeric", month: "short" })}</span>
                <div role="radiogroup" aria-label={`Attendance on ${d}`} className="flex gap-1">
                  {ATTENDANCE_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={s === o.value}
                      onClick={() => void set(d, s === o.value ? null : o.value)}
                      className={clsx("h-6 rounded px-2 text-[11px] font-medium", s === o.value ? o.tone : "text-subtle hover:bg-surface-2 hover:text-fg")}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function GradesTab({ course, scale, programmeTarget }: { course: Course; scale: GradingScale; programmeTarget: number | null }) {
  const client = useQueryClient();
  const data = useCourseStanding(course.id);
  const [busy, setBusy] = useState(false);
  if (data.isPending || !data.data) return <Spinner />;
  const { items, standing: s } = data.data;
  const target = course.targetGrade ?? programmeTarget;
  const targets = [...DEFAULT_TARGETS.map((t) => ({ label: `${t}%`, percent: t })), ...(target != null ? [{ label: `Your target (${formatGrade(scale, target)})`, percent: toPercent(scale, target) }] : [])];
  const finalPercent = s.remainingWeight <= 1e-9 && s.totalWeight > 0 ? (s.earned / s.totalWeight) * 100 : null;

  const setFinal = async () => {
    if (finalPercent == null) return;
    setBusy(true);
    try {
      await updateCourse(course.id, { ...course, finalGrade: percentToScale(scale, finalPercent), status: "completed" });
      await client.invalidateQueries();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card className="grid grid-cols-4 gap-6 p-5">
        <Stat label="Current average" value={pctText(s.current)} sub={s.current != null ? `${formatGrade(scale, percentToScale(scale, s.current))} on your scale` : "Nothing graded yet"} />
        <Stat label="Graded so far" value={`${s.gradedWeight}% of ${s.totalWeight}%`} sub={`${s.earned.toFixed(1)} points earned`} />
        <Stat label="Range still possible" value={s.floor != null ? `${s.floor.toFixed(0)}–${s.ceiling!.toFixed(0)}%` : "—"} sub="If the rest scores 0% / 100%" />
        <Stat label="Final grade" value={formatGrade(scale, course.finalGrade)} sub={course.finalGrade == null ? "Not set" : "Recorded"} />
      </Card>

      {(s.totalWeight !== 100 || s.unweighted > 0) && items.length > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {s.totalWeight !== 100 && `Weights add up to ${s.totalWeight}%, not 100%; results are scaled to that total. `}
          {s.unweighted > 0 && `${s.unweighted} item${s.unweighted === 1 ? " has" : "s have"} no weight and ${s.unweighted === 1 ? "is" : "are"} left out.`}
        </p>
      )}

      <div className="grid grid-cols-[1fr_22rem] items-start gap-5">
        <Card>
          <CardHeader title="Assessments" />
          {items.length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-subtle">Add assignments and exams with weights to use the calculator.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">Assessment</th>
                  <th className="px-2 py-2 text-right font-medium">Weight</th>
                  <th className="px-2 py-2 text-right font-medium">Score</th>
                  <th className="px-4 py-2 text-right font-medium">Counts for</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <Link to={`/studies/${i.kind === "exam" ? "exams" : "assignments"}/${i.id}`} className="hover:text-accent">
                        {i.title}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-right text-muted tabular-nums">{i.weight != null ? `${i.weight}%` : "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{pctText(i.percent)}</td>
                    <td className="px-4 py-2 text-right text-muted tabular-nums">{i.percent != null && i.weight ? `${((i.weight * i.percent) / 100).toFixed(1)} / ${i.weight}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <CardHeader title="To finish with…" />
          <ul className="divide-y divide-border text-sm">
            {targets.map((t) => (
              <li key={t.label} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="font-medium">{t.label}</span>
                <span className="text-right text-muted">
                  <RequirementCell r={requiredFor(s, t.percent)} />
                </span>
              </li>
            ))}
          </ul>
          {finalPercent != null && (
            <div className="border-t border-border px-4 py-3">
              <p className="mb-2 text-sm">
                Everything is graded: <strong>{finalPercent.toFixed(1)}%</strong> = {formatGrade(scale, percentToScale(scale, finalPercent))}
              </p>
              <Button size="sm" variant="primary" loading={busy} onClick={() => void setFinal()} disabled={course.finalGrade === percentToScale(scale, finalPercent)}>
                Record as final grade
              </Button>
            </div>
          )}
          <p className="px-4 pb-3 text-xs text-subtle">Percentages convert to your {scale.min}–{scale.max} scale proportionally. Your university may use a different conversion; you can always set the final grade yourself.</p>
        </Card>
      </div>

      <AttendanceCard course={course} />
    </div>
  );
}
