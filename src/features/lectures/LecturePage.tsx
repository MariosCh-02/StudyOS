import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Link2, MessageSquareText, Pencil, Play, Plus, Presentation, StickyNote, Trash2, User } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader, EmptyState, ErrorState, Spinner } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useCourse, useLecture, useNotes } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import type { Lecture } from "@/domain/types";
import { formatDate } from "@/domain/dates";
import { deleteLecture } from "@/services/lectures";
import { createNote } from "@/services/notes";
import { AttachmentList } from "@/features/attachments/AttachmentList";
import { NoteList } from "@/features/notes/NoteList";
import { LectureForm } from "./LectureForm";
import { TagPicker } from "@/components/TagPicker";
import { ConceptsCard } from "@/features/knowledge/KnowledgePages";
import { lectureLabel, RevisionSelect } from "./lectureUi";

export default function LecturePage() {
  const { lectureId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const lecture = useLecture(lectureId);
  const course = useCourse(lecture.data?.courseId ?? "");
  const notes = useNotes({ lectureId });
  const [editing, setEditing] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  const remove = useConfirmAction(
    (l: Lecture) => deleteLecture(l.id),
    (l) => navigate(`/studies/courses/${l.courseId}`),
  );

  if (lecture.isPending) return <Spinner />;
  if (lecture.error) return <ErrorState error={lecture.error} onRetry={() => void lecture.refetch()} />;
  const l = lecture.data;
  if (!l)
    return (
      <EmptyState
        icon={<Presentation className="size-5" />}
        title="Lecture not found"
        description="It may have been deleted."
        action={<Button onClick={() => navigate("/studies")}>Back to My Studies</Button>}
      />
    );
  if (course.isPending) return <Spinner />;
  const c = course.data;
  if (!c) return <ErrorState error="Course not found." />;

  const addNote = async () => {
    setAddingNote(true);
    try {
      const n = await createNote({ lectureId: l.id, title: `${lectureLabel(l)} (more)` });
      await client.invalidateQueries({ queryKey: ["notes"] });
      navigate(`/notes/${n.id}`);
    } finally {
      setAddingNote(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1.5">
            <Link to={`/studies/courses/${c.id}`} className="hover:text-fg">
              {c.code ? `${c.code} · ${c.name}` : c.name}
            </Link>
            / Lectures
          </span>
        }
        title={lectureLabel(l)}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden />
              {l.date ? formatDate(l.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "No date"}
              {l.startTime && ` · ${l.startTime}`}
            </span>
            {l.lecturer && (
              <span className="flex items-center gap-1">
                <User className="size-3.5" aria-hidden /> {l.lecturer}
              </span>
            )}
            <RevisionSelect lecture={l} />
            <TagPicker type="lecture" id={l.id} compact />
          </span>
        }
        actions={
          <>
            <Button variant="primary" icon={<Play className="size-4" />} onClick={() => navigate(`/lecture/${l.id}`)}>
              Start lecture
            </Button>
            <IconButton label="Edit lecture" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Delete lecture" onClick={() => remove.ask(l)}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        }
      />

      <div className="grid grid-cols-[1fr_22rem] items-start gap-6">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Notes"
              icon={<StickyNote className="size-3.5" />}
              action={
                <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} loading={addingNote} onClick={() => void addNote()}>
                  Add note
                </Button>
              }
            />
            {notes.isPending ? (
              <Spinner />
            ) : (notes.data ?? []).length === 0 ? (
              <EmptyState
                compact
                icon={<StickyNote className="size-4" />}
                title="No notes yet"
                description="“Start lecture” creates the notes from the lecture template automatically."
              />
            ) : (
              <NoteList notes={notes.data ?? []} />
            )}
          </Card>

          {(l.comments || l.links.length > 0) && (
            <Card>
              {l.comments && (
                <>
                  <CardHeader title="Personal comments" icon={<MessageSquareText className="size-3.5" />} />
                  <p className="px-4 pb-4 text-sm leading-relaxed whitespace-pre-wrap text-muted">{l.comments}</p>
                </>
              )}
              {l.links.length > 0 && (
                <>
                  <CardHeader title="Links" icon={<Link2 className="size-3.5" />} />
                  <ul className="px-4 pb-4 text-sm">
                    {l.links.map((link, i) => (
                      <li key={i} className="py-0.5">
                        <a href={link.url} className="text-accent hover:underline">
                          {link.label || link.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5">
        <ConceptsCard type="lecture" id={l.id} />
        <Card>
          <CardHeader title="Slides & files" icon={<Presentation className="size-3.5" />} />
          <div className="px-2 pb-2">
            <AttachmentList owner={{ type: "lecture", id: l.id }} slides onView={(a) => navigate(`/files/${a.id}`)} />
          </div>
          <p className="px-4 pb-3 text-xs text-subtle">Files stay on this computer. Star a PDF to show it first in lecture mode.</p>
        </Card>
        </div>
      </div>

      <LectureForm open={editing} onClose={() => setEditing(false)} course={c} lecture={l} />
      <ConfirmDialog
        open={remove.target != null}
        title="Delete lecture?"
        busy={remove.busy} error={remove.error}
        onClose={remove.cancel}
        onConfirm={remove.confirm}
        message={
          <>
            <p>“{lectureLabel(l)}” with its notes and files will be removed.</p>
            {remove.error && <p className="mt-2 text-danger">{remove.error}</p>}
          </>
        }
      />
    </>
  );
}
