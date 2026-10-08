import { useMemo, useState } from "react";
import { Link } from "react-router";
import { BookOpen, Briefcase, Brain, CalendarRange, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, EmptyState, ErrorState, Spinner } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useAllCourses, useRecurring, useSettings } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { EVENT_TYPE_META, findConflicts } from "@/domain/conflicts";
import { ruleDuration } from "@/domain/recurrence";
import { addDays, addMinutes, dateOf, isoWeekday, joinDateTime, nowLocal, startOfWeek, WEEKDAY_SHORT } from "@/domain/time";
import { formatDateRange } from "@/domain/dates";
import { deleteRecurring, type CalendarItem, type RecurringEvent } from "@/services/calendar";
import { RecurringForm, type RecurringPreset } from "./RecurringForm";
import { TimeGrid } from "./TimeGrid";

/** One synthetic item per weekday of each current or upcoming rule: "your typical week". */
function patternItems(series: RecurringEvent[], weekStart: 1 | 7, courseInfo: Map<string, { code: string | null; color: string | null }>): CalendarItem[] {
  const today = dateOf(nowLocal());
  const first = startOfWeek(today, weekStart);
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  return series
    .filter((s) => !s.endDate || s.endDate >= today)
    .flatMap((s) =>
      days
        .filter((d) => s.weekdays.includes(isoWeekday(d)))
        .map((d) => {
          const start = joinDateTime(d, s.startTime);
          const course = s.courseId ? courseInfo.get(s.courseId) : undefined;
          return {
            key: `${s.id}@${d}`,
            source: "series" as const,
            id: s.id,
            originalDate: d,
            type: s.type,
            title: s.title,
            start,
            end: addMinutes(start, ruleDuration(s)),
            allDay: false,
            location: s.location,
            lecturer: s.lecturer,
            notes: s.notes,
            courseId: s.courseId,
            courseCode: course?.code ?? null,
            courseColor: course?.color ?? null,
            moved: false,
          };
        }),
    );
}

const describe = (s: RecurringEvent) =>
  [
    s.weekdays.map((d) => WEEKDAY_SHORT[d - 1]).join(", "),
    `${s.startTime}–${s.endTime}`,
    s.intervalWeeks > 1 ? `every ${s.intervalWeeks} weeks` : null,
    s.location,
    formatDateRange(s.startDate, s.endDate) || null,
  ]
    .filter(Boolean)
    .join(" · ");

export default function TimetablePage() {
  const series = useRecurring();
  const courses = useAllCourses();
  const settings = useSettings();
  const [form, setForm] = useState<{ series?: RecurringEvent; preset?: RecurringPreset } | null>(null);
  const remove = useConfirmAction((s: RecurringEvent) => deleteRecurring(s.id));
  const weekStart = settings.data?.weekStart === "sunday" ? 7 : 1;

  const courseInfo = useMemo(() => new Map((courses.data ?? []).map((c) => [c.id, { code: c.code, color: c.color }])), [courses.data]);
  const list = series.data ?? [];
  const pattern = useMemo(() => patternItems(list, weekStart, courseInfo), [list, weekStart, courseInfo]);
  const conflicts = useMemo(() => findConflicts(pattern), [pattern]);
  const conflictKeys = useMemo(() => new Set(conflicts.flatMap((c) => [c.a.key, c.b.key])), [conflicts]);

  if (series.isPending) return <Spinner />;
  if (series.error) return <ErrorState error={series.error} onRetry={() => void series.refetch()} />;

  const work = list.filter((s) => s.type === "work");
  const groups = [
    { title: "Classes", icon: BookOpen, items: list.filter((s) => s.type === "class") },
    { title: "Work schedule", icon: Briefcase, items: work },
    { title: "Study routines", icon: Brain, items: list.filter((s) => s.type === "study") },
    { title: "Other", icon: CalendarRange, items: list.filter((s) => !["class", "work", "study"].includes(s.type)) },
  ].filter((g) => g.items.length > 0);

  return (
    <>
      <PageHeader
        title="Timetable"
        subtitle="Your repeating week: classes, work and study routines. Changes apply to every week; adjust single days from the calendar."
        actions={
          <>
            <Link to="/calendar" className="flex h-9 items-center rounded-md px-3 text-sm text-muted hover:bg-surface-2 hover:text-fg">
              Open calendar
            </Link>
            <Button icon={<Briefcase className="size-4" />} onClick={() => setForm(work[0] ? { series: work[0] } : { preset: { type: "work" } })}>
              {work.length ? "Edit work schedule" : "Set work schedule"}
            </Button>
            <Button icon={<Brain className="size-4" />} onClick={() => setForm({ preset: { type: "study" } })}>
              Study routine
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ preset: { type: "class" } })}>
              Add class
            </Button>
          </>
        }
      />

      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarRange className="size-5" />}
            title="Build your weekly timetable"
            description="Add each class once (e.g. Machine Learning, Tuesdays 17:00–19:00, room B204) and StudyOS fills in every week of the semester. Add your work hours too, so conflicts are flagged. Or import your university timetable (.ics) from the calendar."
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ preset: { type: "class" } })}>
                Add your first class
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[1fr_24rem] items-start gap-6">
          <Card className="h-[34rem] overflow-hidden">
            <TimeGrid
              days={Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(dateOf(nowLocal()), weekStart), i))}
              items={pattern}
              conflictKeys={conflictKeys}
              weekdaysOnly
              initialHour={8}
              onItemClick={(i) => {
                const s = list.find((x) => x.id === i.id);
                if (s) setForm({ series: s });
              }}
            />
          </Card>
          <div className="flex flex-col gap-4">
            {conflicts.length > 0 && (
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                🔴 {conflicts.length} weekly conflict{conflicts.length === 1 ? "" : "s"}, e.g. {conflicts[0]!.a.title} and {conflicts[0]!.b.title} on{" "}
                {WEEKDAY_SHORT[isoWeekday(dateOf(conflicts[0]!.b.start)) - 1]}.
              </p>
            )}
            {groups.map((g) => (
              <Card key={g.title}>
                <h2 className="flex items-center gap-2 px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                  <g.icon className="size-3.5" aria-hidden /> {g.title}
                </h2>
                <ul className="divide-y divide-border">
                  {g.items.map((s) => (
                    <li key={s.id} className="group flex items-center gap-2 px-4 py-2.5">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: (s.courseId && courseInfo.get(s.courseId)?.color) || EVENT_TYPE_META[s.type].color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{s.title}</p>
                        <p className="truncate text-xs text-subtle">{describe(s)}</p>
                      </div>
                      <IconButton label={`Edit ${s.title}`} onClick={() => setForm({ series: s })}>
                        <Pencil className="size-3.5" />
                      </IconButton>
                      <IconButton label={`Delete ${s.title}`} onClick={() => remove.ask(s)}>
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      )}

      <RecurringForm open={form != null} series={form?.series} preset={form?.preset} onClose={() => setForm(null)} />
      <ConfirmDialog
        open={remove.target != null}
        title="Delete from timetable?"
        busy={remove.busy} error={remove.error}
        onClose={remove.cancel}
        onConfirm={remove.confirm}
        message={<p>“{remove.target?.title}” will be removed from every week, including past weeks. To stop it from a date onwards, delete it from that day in the calendar instead.</p>}
      />
    </>
  );
}
