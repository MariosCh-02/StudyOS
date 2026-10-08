import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Columns2, FolderOpen, PanelLeftClose, Timer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/Feedback";
import { SplitPane } from "@/components/SplitPane";
import { useCourse, useLecture } from "@/hooks/queries";
import { useSettings } from "@/hooks/queries";
import { useTheme } from "@/hooks/useTheme";
import type { Note } from "@/domain/types";
import { getOrCreateLectureNote } from "@/services/notes";
import { recordAttendance, recordStudySession } from "@/services/tracking";
import { dateOf, nowLocal } from "@/domain/time";
import { NoteWorkspace } from "@/features/notes/NoteWorkspace";
import { SidePanel, type PanelTab } from "@/features/notes/SidePanel";
import { lectureLabel } from "./lectureUi";

type Layout = "pdf" | "files" | "notes";

function SessionClock() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor((now - start) / 1000);
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return (
    <span className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs text-muted tabular-nums" title="Time in this lecture. It's added to your study time when you leave (5 minutes or more), and attendance is marked present.">
      <Timer className="size-3.5" aria-hidden />
      {hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`}
    </span>
  );
}

/**
 * Quick Lecture Mode: a distraction-free workspace for taking notes in class.
 * Opens (or creates from the lecture template) the lecture's main note, with
 * the slides beside it. Everything autosaves.
 */
export default function LectureMode() {
  const { lectureId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const settings = useSettings();
  useTheme(settings.data?.theme);
  const lecture = useLecture(lectureId);
  const course = useCourse(lecture.data?.courseId ?? "");
  const [note, setNote] = useState<Note | null>(null);
  const [noteError, setNoteError] = useState<unknown>(null);
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      return (localStorage.getItem("studyos.lectureLayout") as Layout | null) ?? "pdf";
    } catch {
      return "pdf";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("studyos.lectureLayout", layout);
    } catch {
      // Preference only.
    }
  }, [layout]);

  const l = lecture.data;

  // Attendance and study time are recorded automatically: you were in class.
  useEffect(() => {
    if (!l) return;
    const opened = nowLocal();
    const openedAt = Date.now();
    void recordAttendance(l.courseId, dateOf(opened), "present", l.id).then(() => client.invalidateQueries({ queryKey: ["attendance"] }));
    return () => {
      const minutes = Math.floor((Date.now() - openedAt) / 60_000);
      if (minutes >= 5) {
        void recordStudySession({ start: opened, minutes: Math.min(minutes, 600), kind: "lecture", mode: null, programmeId: null, courseId: l.courseId, lectureId: l.id, taskId: null, topic: l.title, notes: null })
          .then(() => client.invalidateQueries({ queryKey: ["sessions"] }));
      }
    };
  }, [l?.id]);

  // Open the lecture's note, creating it from the template the first time.
  useEffect(() => {
    if (!l) return;
    let alive = true;
    setNote(null);
    getOrCreateLectureNote(l)
      .then(async (n) => {
        if (!alive) return;
        setNote(n);
        await client.invalidateQueries({ queryKey: ["notes"] });
      })
      .catch((err) => alive && setNoteError(err));
    return () => {
      alive = false;
    };
    // Only when the lecture changes, not on every refetch of it.
  }, [l?.id]);

  if (lecture.isPending) return <Spinner label="Opening lecture…" />;
  if (lecture.error) return <ErrorState error={lecture.error} />;
  if (!l)
    return (
      <EmptyState title="Lecture not found" icon={<ArrowLeft className="size-5" />} action={<Button onClick={() => navigate("/studies")}>Back to My Studies</Button>} />
    );
  if (noteError) return <ErrorState error={noteError} />;

  const c = course.data;
  const layouts: { value: Layout; label: string; icon: typeof Columns2 }[] = [
    { value: "pdf", label: "Slides + notes", icon: Columns2 },
    { value: "files", label: "Files + notes", icon: FolderOpen },
    { value: "notes", label: "Notes only", icon: PanelLeftClose },
  ];

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
        <Link
          to={`/studies/lectures/${l.id}`}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:bg-surface-2 hover:text-fg"
          title="Leave lecture mode"
        >
          <ArrowLeft className="size-4" aria-hidden /> Exit
        </Link>
        <span className="h-5 w-px bg-border" aria-hidden />
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: c?.color ?? "var(--accent)" }} />
        <div className="min-w-0 flex-1 truncate text-sm">
          <span className="text-muted">{c?.code ?? c?.name}</span>
          <span className="mx-1.5 text-subtle">·</span>
          <span className="font-medium">{lectureLabel(l)}</span>
        </div>
        <SessionClock />
        <div role="radiogroup" aria-label="Layout" className="flex rounded-md border border-border p-0.5">
          {layouts.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={layout === o.value}
              title={o.label}
              onClick={() => setLayout(o.value)}
              className={clsx("flex h-7 items-center gap-1.5 rounded px-2 text-xs", layout === o.value ? "bg-accent-soft text-accent" : "text-muted hover:text-fg")}
            >
              <o.icon className="size-3.5" aria-hidden />
              <span className="hidden xl:inline">{o.label}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {!note ? (
          <Spinner label="Preparing your notes…" />
        ) : (
          <SplitPane
            storageKey="lecture"
            defaultRatio={0.5}
            collapsed={layout === "notes"}
            left={<SidePanel key={layout} noteId={note.id} lectureId={l.id} courseId={l.courseId} initialTab={layout as PanelTab} />}
            right={<NoteWorkspace key={note.id} note={note} />}
          />
        )}
      </div>
    </div>
  );
}
