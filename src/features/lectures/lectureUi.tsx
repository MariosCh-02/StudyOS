import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { REVISION_LABELS, REVISION_STATUSES, type Lecture, type RevisionStatus } from "@/domain/types";
import { toDateKey } from "@/domain/dates";
import { getOrCreateTodaysLecture, setRevisionStatus } from "@/services/lectures";

export const REVISION_STYLE: Record<RevisionStatus, string> = {
  not_reviewed: "bg-surface-2 text-muted",
  needs_review: "bg-warning-soft text-warning",
  reviewed: "bg-accent-soft text-accent",
  mastered: "bg-success-soft text-success",
};

/** Inline revision-status picker that saves immediately. */
export function RevisionSelect({ lecture, className }: { lecture: Lecture; className?: string }) {
  const client = useQueryClient();
  const [value, setValue] = useState(lecture.revisionStatus);
  useEffect(() => {
    setValue(lecture.revisionStatus);
  }, [lecture.revisionStatus]);
  const change = async (v: RevisionStatus) => {
    setValue(v);
    try {
      await setRevisionStatus(lecture.id, v);
      await client.invalidateQueries();
    } catch {
      setValue(lecture.revisionStatus);
    }
  };
  return (
    <select
      aria-label="Revision status"
      value={value}
      onChange={(e) => void change(e.target.value as RevisionStatus)}
      onClick={(e) => e.stopPropagation()}
      className={clsx("h-6 cursor-pointer rounded-full border-0 px-2 text-[11px] font-medium focus:ring-2 focus:ring-accent focus:outline-none", REVISION_STYLE[value], className)}
    >
      {REVISION_STATUSES.map((s) => (
        <option key={s} value={s}>
          {REVISION_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

export const lectureLabel = (l: Pick<Lecture, "number" | "title">) => (l.number != null ? `Lecture ${l.number} — ${l.title}` : l.title);

/** Opens Quick Lecture Mode for today's lecture of a course (creating it if needed). */
export function useStartTodaysLecture() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async (courseId: string) => {
    setBusy(true);
    setError(null);
    try {
      const lecture = await getOrCreateTodaysLecture(courseId, toDateKey(new Date()));
      await client.invalidateQueries();
      navigate(`/lecture/${lecture.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return { start, busy, error };
}
