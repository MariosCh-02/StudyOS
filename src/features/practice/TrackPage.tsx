import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, Circle, Map as MapIcon, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, EmptyState, ErrorState, ProgressBar, Spinner } from "@/components/ui/Feedback";
import { ConfirmDialog, FormModal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/Field";
import { useLessons, useSubjects, useTrack } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { createSubject, deleteSubject, deleteTrack, LEVEL_LABELS, type Subject, type Track } from "@/services/learning";
import { LessonForm } from "./LessonForm";
import { TrackForm } from "./TracksTab";

function SubjectDialog({ open, onClose, trackId }: { open: boolean; onClose: () => void; trackId: string }) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const submit = async () => {
    try {
      await createSubject(trackId, name);
      await client.invalidateQueries();
      setName("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <FormModal open={open} onClose={onClose} title="New subject" submitLabel="Add subject" onSubmit={() => void submit()}>
      <TextField label="Subject" autoFocus value={name} onChange={(e) => setName(e.target.value)} error={error} placeholder="e.g. Linear Algebra, Contract Law" />
    </FormModal>
  );
}

export default function TrackPage() {
  const { trackId = "" } = useParams();
  const navigate = useNavigate();
  const track = useTrack(trackId);
  const subjects = useSubjects(trackId);
  const lessons = useLessons({ trackId });
  const [editing, setEditing] = useState(false);
  const [addingSubject, setAddingSubject] = useState(false);
  const [lessonForm, setLessonForm] = useState<{ subjectId: string; level: number } | null>(null);
  const removeTrack = useConfirmAction((t: Track) => deleteTrack(t.id), () => navigate("/practice"));
  const removeSubject = useConfirmAction((s: Subject) => deleteSubject(s.id));

  if (track.isPending || subjects.isPending || lessons.isPending) return <Spinner />;
  if (track.error) return <ErrorState error={track.error} />;
  const t = track.data;
  if (!t) return <EmptyState icon={<MapIcon className="size-5" />} title="Track not found" action={<Button onClick={() => navigate("/practice")}>Back to Practice</Button>} />;
  const subjectList = subjects.data ?? [];
  const lessonList = lessons.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/practice" className="hover:text-fg">
            Practice
          </Link>
        }
        title={t.title}
        subtitle={t.description ?? undefined}
        actions={
          <>
            <Button variant="primary" icon={<Play className="size-4" />} onClick={() => navigate(`/practice/quiz?track=${t.id}&title=${encodeURIComponent(t.title)}`)}>
              Practise track
            </Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setAddingSubject(true)}>
              Subject
            </Button>
            <IconButton label="Edit track" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Delete track" onClick={() => removeTrack.ask(t)}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        }
      />
      {t.lessonCount > 0 && (
        <div className="mb-6 flex items-center gap-3 text-sm text-muted">
          <span className="tabular-nums">
            {t.completedCount} / {t.lessonCount} lessons
          </span>
          <div className="flex-1">
            <ProgressBar value={t.completedCount / t.lessonCount} label="Track progress" />
          </div>
        </div>
      )}

      {subjectList.length === 0 ? (
        <Card>
          <EmptyState icon={<MapIcon className="size-5" />} title="Add the first subject" description="Subjects group lessons, and each subject has four levels: Foundation, University, Advanced and Challenge." action={<Button variant="primary" onClick={() => setAddingSubject(true)}>Add subject</Button>} />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {subjectList.map((s) => {
            const subjectLessons = lessonList.filter((l) => l.subjectId === s.id);
            const done = subjectLessons.filter((l) => l.completedAt).length;
            return (
              <Card key={s.id}>
                <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-subtle">
                      {done} / {subjectLessons.length} lessons
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" icon={<Play className="size-3.5" />} onClick={() => navigate(`/practice/quiz?subject=${s.id}&title=${encodeURIComponent(s.name)}`)}>
                    Practise
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setLessonForm({ subjectId: s.id, level: 1 })}>
                    Lesson
                  </Button>
                  <IconButton label={`Delete ${s.name}`} onClick={() => removeSubject.ask(s)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
                <div className="grid grid-cols-4 divide-x divide-border">
                  {[1, 2, 3, 4].map((level) => {
                    const items = subjectLessons.filter((l) => l.level === level);
                    return (
                      <div key={level} className="flex min-h-24 flex-col p-3">
                        <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
                          {level}. {LEVEL_LABELS[level]}
                        </p>
                        <ul className="flex-1 space-y-1">
                          {items.map((l) => (
                            <li key={l.id}>
                              <Link to={`/practice/lessons/${l.id}`} className="group flex items-start gap-1.5 text-sm hover:text-accent">
                                {l.completedAt ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="Completed" /> : <Circle className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />}
                                <span className={clsx(l.completedAt && "text-muted")}>{l.title}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                        <button type="button" onClick={() => setLessonForm({ subjectId: s.id, level })} className="mt-2 self-start text-xs text-subtle hover:text-accent">
                          + Add
                        </button>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <TrackForm open={editing} track={t} onClose={() => setEditing(false)} />
      <SubjectDialog open={addingSubject} onClose={() => setAddingSubject(false)} trackId={t.id} />
      <LessonForm open={lessonForm != null} onClose={() => setLessonForm(null)} subjects={subjectList} defaultSubjectId={lessonForm?.subjectId} defaultLevel={lessonForm?.level} />
      <ConfirmDialog open={removeTrack.target != null} title="Delete track?" busy={removeTrack.busy} error={removeTrack.error} onClose={removeTrack.cancel} onConfirm={removeTrack.confirm} message={<p>“{t.title}” with its subjects and lessons will be removed. Questions, flashcards and your progress stay in the bank.</p>} />
      <ConfirmDialog open={removeSubject.target != null} title="Delete subject?" busy={removeSubject.busy} error={removeSubject.error} onClose={removeSubject.cancel} onConfirm={removeSubject.confirm} message={<p>“{removeSubject.target?.name}” and its lessons will be removed.</p>} />
    </>
  );
}
