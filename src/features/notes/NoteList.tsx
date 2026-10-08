import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Pin } from "lucide-react";
import type { Course, NoteSummary } from "@/domain/types";
import { setNotePinned } from "@/services/notes";

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

interface Props {
  notes: NoteSummary[];
  courses?: Map<string, Course>;
  showCourse?: boolean;
}

export function NoteList({ notes, courses, showCourse }: Props) {
  const client = useQueryClient();
  const togglePin = async (n: NoteSummary) => {
    await setNotePinned(n.id, !n.pinned);
    await client.invalidateQueries({ queryKey: ["notes"] });
  };

  return (
    <ul className="divide-y divide-border">
      {notes.map((n) => {
        const course = n.courseId ? courses?.get(n.courseId) : undefined;
        return (
          <li key={n.id} className="group relative">
            <Link to={`/notes/${n.id}`} className="block px-4 py-3 pr-12 transition-colors hover:bg-surface-2">
              <div className="flex items-center gap-2">
                {course && <span className="size-2 shrink-0 rounded-full" style={{ background: course.color ?? "var(--subtle)" }} />}
                <span className="truncate text-sm font-medium group-hover:text-accent">{n.title || "Untitled note"}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{n.snippet || "Empty note"}</p>
              <p className="mt-1 text-xs text-subtle">
                {showCourse && course ? `${course.code ?? course.name} · ` : ""}
                {n.lectureId ? "Lecture note · " : ""}
                Edited {relativeTime(n.updatedAt)}
              </p>
            </Link>
            <button
              type="button"
              onClick={() => void togglePin(n)}
              aria-label={n.pinned ? "Unpin note" : "Pin note"}
              aria-pressed={n.pinned}
              className={clsx(
                "absolute top-3 right-3 rounded p-1.5 transition-opacity hover:bg-surface",
                n.pinned ? "text-accent" : "text-subtle opacity-0 group-hover:opacity-100 focus:opacity-100",
              )}
            >
              <Pin className={clsx("size-3.5", n.pinned && "fill-current")} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
