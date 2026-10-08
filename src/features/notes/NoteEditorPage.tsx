import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Columns2, LayoutTemplate, Pin, StickyNote, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/Feedback";
import { ConfirmDialog, FormModal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/Field";
import { SplitPane } from "@/components/SplitPane";
import { useCourse, useLecture, usePaper, useProject, useNote } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { flushAll } from "@/lib/flush";
import { parseDoc } from "@/domain/noteContent";
import type { Note } from "@/domain/types";
import { deleteNote, getNote, setNotePinned } from "@/services/notes";
import { createTemplate } from "@/services/templates";
import { NoteWorkspace } from "./NoteWorkspace";
import { SidePanel } from "./SidePanel";
import { ExportMenu } from "@/components/ExportMenu";
import { noteExports } from "@/features/export/exportItems";

function readSplit(): boolean {
  try {
    return localStorage.getItem("studyos.noteSplit") === "1";
  } catch {
    return false;
  }
}

function SaveTemplateDialog({ open, note, onClose }: { open: boolean; note: Note; onClose: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await flushAll(); // template from what's on screen, not the last autosave
      const latest = await getNote(note.id);
      await createTemplate(name, parseDoc(latest?.content ?? note.content));
      await client.invalidateQueries({ queryKey: ["templates"] });
      setName("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormModal open={open} onClose={onClose} title="Save as template" submitLabel="Save template" submitting={busy} onSubmit={() => void submit()}>
      <TextField
        label="Template name"
        autoFocus
        placeholder="e.g. Seminar notes, Lab report, Case brief"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={error}
        hint="Use {{title}}, {{course}} or {{date}} in the note to have them filled in for new notes."
      />
    </FormModal>
  );
}

export default function NoteEditorPage() {
  const { noteId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const note = useNote(noteId);
  const course = useCourse(note.data?.courseId ?? "");
  const lecture = useLecture(note.data?.lectureId ?? "");
  const project = useProject(note.data?.projectId ?? "");
  const paper = usePaper(note.data?.paperId ?? "");
  const [split, setSplit] = useState(readSplit);
  const [templateOpen, setTemplateOpen] = useState(false);
  const remove = useConfirmAction(
    (n: Note) => deleteNote(n.id),
    () => navigate(-1),
  );

  const toggleSplit = () => {
    setSplit((s) => {
      try {
        localStorage.setItem("studyos.noteSplit", s ? "0" : "1");
      } catch {
        // Preference only.
      }
      return !s;
    });
  };

  if (note.isPending) return <Spinner />;
  if (note.error) return <ErrorState error={note.error} onRetry={() => void note.refetch()} />;
  const n = note.data;
  if (!n)
    return (
      <EmptyState
        icon={<StickyNote className="size-5" />}
        title="Note not found"
        description="It may have been deleted."
        action={<Button onClick={() => navigate("/notes")}>All notes</Button>}
      />
    );

  const togglePin = async () => {
    await setNotePinned(n.id, !n.pinned);
    await client.invalidateQueries({ queryKey: ["notes"] });
    await note.refetch();
  };

  const workspace = (
    <NoteWorkspace
      key={n.id}
      note={n}
      actions={
        <div className="flex items-center gap-0.5">
          <IconButton label={n.pinned ? "Unpin" : "Pin"} onClick={() => void togglePin()} className={n.pinned ? "text-accent" : undefined}>
            <Pin className={clsx("size-4", n.pinned && "fill-current")} />
          </IconButton>
          <IconButton label={split ? "Close side panel" : "Open side panel (PDF / files)"} onClick={toggleSplit} className={split ? "text-accent" : undefined}>
            <Columns2 className="size-4" />
          </IconButton>
          <IconButton label="Save as template" onClick={() => setTemplateOpen(true)}>
            <LayoutTemplate className="size-4" />
          </IconButton>
          <ExportMenu size="sm" items={noteExports(n.id)} />
          <IconButton label="Delete note" onClick={() => remove.ask(n)}>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      }
    />
  );

  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Breadcrumb" className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-4 text-xs text-muted">
        <Link to="/notes" className="hover:text-fg">
          Notes
        </Link>
        {course.data && (
          <>
            /
            <Link to={`/studies/courses/${course.data.id}`} className="hover:text-fg">
              {course.data.code ?? course.data.name}
            </Link>
          </>
        )}
        {lecture.data && (
          <>
            /
            <Link to={`/studies/lectures/${lecture.data.id}`} className="hover:text-fg">
              {lecture.data.number != null ? `Lecture ${lecture.data.number}` : lecture.data.title}
            </Link>
          </>
        )}
        {project.data && (
          <>
            /
            <Link to={`/projects/${project.data.id}`} className="max-w-64 truncate hover:text-fg">
              {project.data.title}
            </Link>
          </>
        )}
        {paper.data && (
          <>
            /
            <Link to={`/papers/${paper.data.id}`} className="max-w-64 truncate hover:text-fg">
              {paper.data.title}
            </Link>
          </>
        )}
      </nav>
      <div className="min-h-0 flex-1">
        <SplitPane
          storageKey="note"
          defaultRatio={0.45}
          collapsed={!split}
          left={<SidePanel key={n.id} noteId={n.id} lectureId={n.lectureId} courseId={n.courseId} paperId={n.paperId} projectId={n.projectId} />}
          right={workspace}
        />
      </div>
      <SaveTemplateDialog open={templateOpen} note={n} onClose={() => setTemplateOpen(false)} />
      <ConfirmDialog
        open={remove.target != null}
        title="Delete note?"
        busy={remove.busy} error={remove.error}
        onClose={remove.cancel}
        onConfirm={remove.confirm}
        message={<p>“{n.title || "Untitled note"}” and its attached files will be removed.</p>}
      />
    </div>
  );
}
