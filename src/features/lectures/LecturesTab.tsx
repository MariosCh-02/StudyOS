import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { CalendarDays, Play, Plus, Presentation } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, EmptyState, ErrorState, Spinner } from "@/components/ui/Feedback";
import { useLectures } from "@/hooks/queries";
import type { Course } from "@/domain/types";
import { formatDate, toDateKey } from "@/domain/dates";
import { LectureForm } from "./LectureForm";
import { RevisionSelect, useStartTodaysLecture } from "./lectureUi";

export function LecturesTab({ course }: { course: Course }) {
  const lectures = useLectures(course.id);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const today = toDateKey(new Date());
  const startToday = useStartTodaysLecture();

  if (lectures.isPending) return <Spinner />;
  if (lectures.error) return <ErrorState error={lectures.error} onRetry={() => void lectures.refetch()} />;
  const list = lectures.data;
  const todays = list.find((l) => l.date === today);
  const counts = list.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.revisionStatus]: (acc[l.revisionStatus] ?? 0) + 1 }), {});

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {list.length} lecture{list.length === 1 ? "" : "s"}
          {list.length > 0 && ` · ${counts.mastered ?? 0} mastered · ${counts.needs_review ?? 0} need review`}
        </p>
        <div className="flex gap-2">
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New lecture
          </Button>
          <Button variant="primary" icon={<Play className="size-4" />} loading={startToday.busy} onClick={() => void startToday.start(course.id)}>
            {todays ? "Start today's lecture" : "Start a lecture now"}
          </Button>
        </div>
      </div>
      {startToday.error && <p className="text-sm text-danger">{startToday.error}</p>}

      <Card>
        {list.length === 0 ? (
          <EmptyState
            icon={<Presentation className="size-5" />}
            title="No lectures yet"
            description="Press “Start a lecture now” during class: StudyOS creates today's lecture, opens the notes template and puts your slides beside it."
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((l) => (
              <li key={l.id} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                <span className="w-8 shrink-0 text-right text-sm font-semibold text-subtle tabular-nums">{l.number ?? "–"}</span>
                <Link to={`/studies/lectures/${l.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-sm group-hover:text-accent">{l.title}</span>
                  <span className="flex items-center gap-1 text-xs text-subtle">
                    <CalendarDays className="size-3" aria-hidden />
                    {l.date ? formatDate(l.date, { weekday: "short", day: "numeric", month: "short" }) : "No date"}
                    {l.startTime && ` · ${l.startTime}`}
                    {l.date === today && <span className="ml-1 font-medium text-accent">Today</span>}
                  </span>
                </Link>
                <RevisionSelect lecture={l} />
                <IconButton label={`Open ${l.title} in lecture mode`} onClick={() => navigate(`/lecture/${l.id}`)}>
                  <Play className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <LectureForm open={creating} onClose={() => setCreating(false)} course={course} onSaved={(l) => navigate(`/studies/lectures/${l.id}`)} />
    </div>
  );
}
