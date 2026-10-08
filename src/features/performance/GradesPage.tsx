import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowDown, ArrowUp, FlaskConical, GraduationCap, Lightbulb, RotateCcw, Trophy } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Spinner, Stat } from "@/components/ui/Feedback";
import { GradeInput, parseOptionalNumber } from "@/components/ui/Pickers";
import { usePerformance, useSettings } from "@/hooks/queries";
import { formatGrade, whatIf, type GradingScale } from "@/domain/grading";
import { formatDuration } from "@/domain/time";
import { setSetting } from "@/services/settings";
import type { CoursePerformance, PerformanceData } from "@/services/performance";
import { ExportMenu } from "@/components/ExportMenu";
import { gradesExports } from "@/features/export/exportItems";

function Delta({ value, scale }: { value: number | null; scale: GradingScale }) {
  if (value == null) return <span className="text-subtle">—</span>;
  const up = value >= 0;
  return (
    <span className={clsx("inline-flex items-center gap-0.5", up ? "text-success" : "text-danger")}>
      {up ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />}
      {Math.abs(value).toFixed(scale.decimals)}
    </span>
  );
}

function WhatIfPanel({ data }: { data: PerformanceData }) {
  const scale = data.programme.gradingScale;
  const [values, setValues] = useState<Record<string, string>>({});
  const overrides = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, v] of Object.entries(values)) {
      const n = parseOptionalNumber(v);
      if (n != null && Number.isFinite(n) && n >= scale.min && n <= scale.max) m.set(id, n);
    }
    return m;
  }, [values, scale]);
  const courses = data.courses.map((c) => ({ id: c.course.id, status: c.course.status, finalGrade: c.course.finalGrade, credits: c.course.credits }));
  const projected = whatIf(courses, overrides, scale, data.programme.totalCredits);
  const base = data.stats.average;
  const target = data.programme.targetGrade;

  return (
    <Card>
      <CardHeader
        title="What if?"
        icon={<FlaskConical className="size-3.5" />}
        action={
          overrides.size > 0 && (
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setValues({})}>
              Reset
            </Button>
          )
        }
      />
      <p className="px-4 text-[13px] text-muted">Try grades for courses that aren't finished (or change finished ones) and see your projected average.</p>
      <div className="grid grid-cols-3 gap-4 px-4 py-3">
        <Stat label="Average now" value={formatGrade(scale, base)} />
        <Stat label="Projected" value={formatGrade(scale, projected.average)} sub={projected.average != null && base != null ? <Delta value={projected.average - base} scale={scale} /> : undefined} />
        <Stat
          label="vs target"
          value={target != null && projected.average != null ? (projected.average >= target ? "On target" : "Below") : "—"}
          sub={target != null && projected.average != null ? <Delta value={projected.average - target} scale={scale} /> : target == null ? "Set a target on the programme" : undefined}
        />
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {data.courses.map((c) => (
          <li key={c.course.id} className="grid grid-cols-[1fr_9rem] items-center gap-3 px-4 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm">{c.course.name}</p>
              <p className="text-xs text-subtle">
                {c.course.credits ?? 0} {data.programme.creditUnit} · {c.course.finalGrade != null ? `final ${formatGrade(scale, c.course.finalGrade)}` : c.currentOnScale != null ? `currently ${formatGrade(scale, c.currentOnScale)}` : "no grade yet"}
              </p>
            </div>
            <GradeInput label={`What-if grade for ${c.course.name}`} scale={scale} value={values[c.course.id] ?? ""} onChange={(v) => setValues((x) => ({ ...x, [c.course.id]: v }))} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CourseTable({ data }: { data: PerformanceData }) {
  const scale = data.programme.gradingScale;
  const ranked = [...data.courses].filter((c) => c.effectiveGrade != null).sort((a, b) => b.effectiveGrade! - a.effectiveGrade!);
  const strongest = ranked[0]?.course.id;
  const weakest = ranked.length > 1 ? ranked.at(-1)!.course.id : undefined;
  const target = (c: CoursePerformance) => c.course.targetGrade ?? data.programme.targetGrade;

  return (
    <Card>
      <CardHeader title="Courses" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium">Course</th>
              <th className="px-2 py-2 text-right font-medium">Current</th>
              <th className="px-2 py-2 text-right font-medium">Grade</th>
              <th className="px-2 py-2 text-right font-medium">Target</th>
              <th className="px-2 py-2 text-right font-medium">Needed on rest</th>
              <th className="px-2 py-2 text-right font-medium">Attendance</th>
              <th className="px-4 py-2 text-right font-medium">Study (14 d)</th>
            </tr>
          </thead>
          <tbody>
            {data.courses.map((c) => (
              <tr key={c.course.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  <Link to={`/studies/courses/${c.course.id}?tab=grades`} className="hover:text-accent">
                    {c.course.name}
                  </Link>{" "}
                  {c.course.id === strongest && <Badge tone="success">Strongest</Badge>}
                  {c.course.id === weakest && <Badge tone="warning">Weakest</Badge>}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{c.currentPercent != null ? `${c.currentPercent.toFixed(1)}%` : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatGrade(scale, c.effectiveGrade)}</td>
                <td className="px-2 py-2 text-right text-muted tabular-nums">{formatGrade(scale, target(c))}</td>
                <td className={clsx("px-2 py-2 text-right tabular-nums", c.targetReachable === false && "text-danger")}>
                  {c.requiredForTarget == null ? "—" : c.requiredForTarget === 0 ? "Secured" : c.targetReachable === false ? "Out of reach" : `${c.requiredForTarget.toFixed(0)}%`}
                </td>
                <td className={clsx("px-2 py-2 text-right tabular-nums", c.attendanceRate != null && c.attendanceRate < 0.8 && "text-warning")}>
                  {c.attendanceRate != null ? `${Math.round(c.attendanceRate * 100)}%` : "—"}
                </td>
                <td className="px-4 py-2 text-right text-muted tabular-nums">{c.studyMinutes14 ? formatDuration(c.studyMinutes14) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TopStudentPanel({ data, enabled }: { data: PerformanceData; enabled: boolean }) {
  const client = useQueryClient();
  const toggle = async () => {
    await setSetting("topStudentMode", enabled ? "off" : "on");
    await client.invalidateQueries({ queryKey: ["settings"] });
  };
  return (
    <Card className={enabled ? "border-accent/50" : undefined}>
      <CardHeader
        title="Top Student Mode"
        icon={<Trophy className="size-3.5" />}
        action={
          <Button size="sm" variant={enabled ? "ghost" : "primary"} onClick={() => void toggle()}>
            {enabled ? "Turn off" : "Turn on"}
          </Button>
        }
      />
      {!enabled ? (
        <p className="px-4 pb-4 text-[13px] text-muted">Get specific recommendations from your own grades, deadlines, attendance and study time, for when you're aiming for the top of your class.</p>
      ) : data.recommendations.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-muted">Nothing to flag right now. Add grades, deadlines and study sessions for recommendations.</p>
      ) : (
        <ul className="space-y-2 px-4 pb-4">
          {data.recommendations.map((r) => (
            <li key={r.text} className="flex gap-2 text-sm">
              <Lightbulb className={clsx("mt-0.5 size-4 shrink-0", r.priority === 1 ? "text-warning" : "text-subtle")} aria-hidden />
              {r.text}
            </li>
          ))}
        </ul>
      )}
      {enabled && <p className="px-4 pb-3 text-xs text-subtle">Based only on data stored in StudyOS. StudyOS doesn't know your class ranking.</p>}
    </Card>
  );
}

export default function GradesPage() {
  const settings = useSettings();
  const perf = usePerformance(settings.data?.weekStart === "sunday" ? 7 : 1);

  if (perf.isPending) return <Spinner />;
  if (perf.error) return <ErrorState error={perf.error} onRetry={() => void perf.refetch()} />;
  const data = perf.data;
  if (!data)
    return (
      <EmptyState
        icon={<GraduationCap className="size-5" />}
        title="No programme yet"
        description="Create a programme in My Studies to track grades."
        action={
          <Link to="/studies" className="text-sm text-accent hover:underline">
            Go to My Studies
          </Link>
        }
      />
    );

  const scale = data.programme.gradingScale;
  const target = data.programme.targetGrade;
  const topMode = settings.data?.topStudentMode === "on";

  return (
    <>
      <PageHeader title="Grades & performance" subtitle={`${data.programme.name} · ${data.programme.institutionName}`} actions={<ExportMenu items={gradesExports()} />} />
      <Card className="mb-6 grid grid-cols-5 gap-6 p-5">
        <Stat label="Current average" value={formatGrade(scale, data.stats.average)} sub={`${data.stats.gradedCredits} ${data.programme.creditUnit} with final grades`} />
        <Stat label="Projected" value={formatGrade(scale, data.projectedAverage)} sub="Including work so far in current courses" />
        <Stat label="Target" value={formatGrade(scale, target)} sub={target != null && data.projectedAverage != null ? <Delta value={data.projectedAverage - target} scale={scale} /> : "Set on the programme"} />
        <Stat label="Cumulative" value={data.cumulativePercent != null ? `${data.cumulativePercent.toFixed(1)}%` : "—"} sub="All programmes, as % of each scale" />
        <Stat label="Programme progress" value={data.stats.progress != null ? `${Math.round(data.stats.progress * 100)}%` : "—"} sub={`${data.stats.earnedCredits}${data.programme.totalCredits ? ` / ${data.programme.totalCredits}` : ""} ${data.programme.creditUnit}`} />
      </Card>

      <div className="grid grid-cols-[1fr_24rem] items-start gap-6">
        <div className="flex flex-col gap-6">
          <CourseTable data={data} />
          <div className="grid grid-cols-2 gap-6">
            <Card>
              <CardHeader title="Semesters" />
              {data.semesterAverages.length === 0 ? (
                <p className="px-4 pb-4 text-[13px] text-subtle">No semesters in this programme.</p>
              ) : (
                <ul className="px-4 pb-3 text-sm">
                  {data.semesterAverages.map((s) => (
                    <li key={s.semester.id} className="flex justify-between py-1">
                      <span>{s.semester.label}</span>
                      <span className="tabular-nums">
                        {formatGrade(scale, s.average)} <span className="text-xs text-subtle">· {s.credits} {data.programme.creditUnit}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Assessments & effort" />
              <ul className="px-4 pb-3 text-sm">
                <li className="flex justify-between py-1">
                  <span>Assignment average</span>
                  <span className="tabular-nums">{data.assignmentAverage != null ? `${data.assignmentAverage.toFixed(1)}%` : "—"}</span>
                </li>
                <li className="flex justify-between py-1">
                  <span>Exam average</span>
                  <span className="tabular-nums">{data.examAverage != null ? `${data.examAverage.toFixed(1)}%` : "—"}</span>
                </li>
                <li className="flex justify-between py-1">
                  <span>Study this week</span>
                  <span className="tabular-nums">{formatDuration(data.study.week)}</span>
                </li>
                <li className="flex justify-between py-1">
                  <span>Days studied (last 14)</span>
                  <span className="tabular-nums">{data.study.activeDays14}</span>
                </li>
              </ul>
            </Card>
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <TopStudentPanel data={data} enabled={topMode} />
          <WhatIfPanel data={data} />
        </div>
      </div>
    </>
  );
}
