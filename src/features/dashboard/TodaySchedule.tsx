import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import clsx from "clsx";
import { AlertTriangle, CalendarDays, Play } from "lucide-react";
import { Card, CardHeader, Spinner } from "@/components/ui/Feedback";
import { useCalendarItems, useLecturesToday } from "@/hooks/queries";
import { EVENT_TYPE_META, findConflicts } from "@/domain/conflicts";
import { addDays, dateOf, diffMinutes, formatDuration, nowLocal, timeOf } from "@/domain/time";
import { getOrCreateLectureForDate } from "@/services/lectures";
import { lectureLabel } from "@/features/lectures/lectureUi";
import { itemColor } from "@/features/calendar/TimeGrid";
import type { CalendarItem } from "@/services/calendar";

/** The dashboard's TODAY section: work, classes and study in time order, with conflicts and the next event. */
export function TodaySchedule() {
  const navigate = useNavigate();
  const now = nowLocal();
  const today = dateOf(now);
  const items = useCalendarItems(addDays(today, -1), today);
  const lectures = useLecturesToday();
  const [starting, setStarting] = useState<string | null>(null);

  const todays = useMemo(
    () => (items.data ?? []).filter((i) => dateOf(i.start) === today || (i.end > `${today}T00:00` && dateOf(i.start) < today)),
    [items.data, today],
  );
  const conflictKeys = useMemo(() => new Set(findConflicts(todays).flatMap((c) => [c.a.key, c.b.key])), [todays]);
  const next = todays.find((i) => !i.allDay && i.end > now);

  // Lectures dated today for courses that have no class on the timetable today.
  const classCourses = new Set(todays.filter((i) => i.type === "class").map((i) => i.courseId));
  const extraLectures = (lectures.data ?? []).filter((l) => !classCourses.has(l.courseId));

  const start = async (i: CalendarItem) => {
    if (!i.courseId) return;
    setStarting(i.key);
    try {
      const lecture = await getOrCreateLectureForDate(i.courseId, today, timeOf(i.start));
      navigate(`/lecture/${lecture.id}`);
    } finally {
      setStarting(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Today"
        icon={<CalendarDays className="size-3.5" />}
        action={
          <Link to="/calendar" className="text-xs text-accent hover:underline">
            Calendar
          </Link>
        }
      />
      {items.isPending ? (
        <Spinner />
      ) : todays.length === 0 && extraLectures.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-subtle">
          Nothing scheduled today.{" "}
          <Link to="/timetable" className="text-accent hover:underline">
            Set up your timetable
          </Link>
        </p>
      ) : (
        <>
          {next && (
            <p className="mx-4 mb-2 rounded-md bg-accent-soft px-3 py-2 text-[13px] text-accent">
              {next.start <= now ? "Now: " : "Next: "}
              <span className="font-medium">{next.title}</span>
              {next.start > now ? ` at ${timeOf(next.start)} (in ${formatDuration(diffMinutes(now, next.start))})` : ` until ${timeOf(next.end)}`}
              {next.location ? ` · ${next.location}` : ""}
            </p>
          )}
          <ul className="pb-1">
            {todays.map((i) => {
              const past = !i.allDay && i.end <= now;
              return (
                <li key={i.key} className={clsx("flex items-center gap-3 px-4 py-2", past && "opacity-50")}>
                  <span className="w-[5.5rem] shrink-0 text-xs text-muted tabular-nums">{i.allDay ? "All day" : `${timeOf(i.start)}–${timeOf(i.end)}`}</span>
                  <span className="h-7 w-1 shrink-0 rounded-full" style={{ background: itemColor(i) }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-sm">
                      {EVENT_TYPE_META[i.type].emoji} {i.title}
                      {conflictKeys.has(i.key) && <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-label="Schedule conflict" />}
                    </span>
                    {(i.location || i.courseCode) && <span className="block truncate text-xs text-subtle">{[i.courseCode, i.location].filter(Boolean).join(" · ")}</span>}
                  </span>
                  {i.type === "class" && i.courseId && !past && (
                    <button
                      type="button"
                      disabled={starting === i.key}
                      onClick={() => void start(i)}
                      className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-xs font-medium text-accent-fg hover:brightness-110 disabled:opacity-60"
                    >
                      <Play className="size-3" aria-hidden /> Start
                    </button>
                  )}
                </li>
              );
            })}
            {extraLectures.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-2">
                <span className="w-[5.5rem] shrink-0 text-xs text-muted tabular-nums">{l.startTime ?? "Today"}</span>
                <span className="h-7 w-1 shrink-0 rounded-full" style={{ background: l.courseColor ?? "var(--subtle)" }} />
                <Link to={`/studies/lectures/${l.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-accent">
                  🎓 {lectureLabel(l)}
                </Link>
                <button
                  type="button"
                  onClick={() => navigate(`/lecture/${l.id}`)}
                  className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-xs font-medium text-accent-fg hover:brightness-110"
                >
                  <Play className="size-3" aria-hidden /> Start
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
