import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Clock, Layers, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Spinner } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { LessonContent } from "./LessonContent";
import { useFlashcards, useLesson, useLessons, useQuestions, useSubjects } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { QUESTION_TYPE_LABELS } from "@/domain/questions";
import { formatDuration } from "@/domain/time";
import { deleteLesson, LEVEL_LABELS, setLessonCompleted, type Lesson } from "@/services/learning";
import { FlashcardForm } from "@/features/flashcards/FlashcardForm";
import { LessonForm } from "./LessonForm";
import { QuestionForm } from "./QuestionForm";
import { StartProjectCard } from "@/features/projects/StartProjectCard";
import { parseMilestones } from "@/domain/research";

export default function LessonPage() {
  const { lessonId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const lesson = useLesson(lessonId);
  const siblings = useLessons({ trackId: lesson.data?.trackId });
  const subjects = useSubjects(lesson.data?.trackId);
  const questions = useQuestions({ lessonId }, !!lessonId);
  const cards = useFlashcards({ lessonId });
  const [editing, setEditing] = useState(false);
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  const remove = useConfirmAction((l: Lesson) => deleteLesson(l.id), (l) => navigate(`/practice/tracks/${l.trackId}`));
  const l = lesson.data;
  const questionDefaults = useMemo(() => (l ? { lessonId: l.id, subjectId: l.subjectId, topicName: l.topicName ?? undefined } : undefined), [l?.id, l?.subjectId, l?.topicName]);
  const milestoneCount = useMemo(() => parseMilestones(lesson.data?.content ?? "").length, [lesson.data?.content]);
  const cardDefaults = useMemo(() => (l ? { lessonId: l.id, subjectId: l.subjectId, topicName: l.topicName } : undefined), [l?.id, l?.subjectId, l?.topicName]);

  if (lesson.isPending) return <Spinner />;
  if (lesson.error) return <ErrorState error={lesson.error} />;
  if (!l) return <EmptyState icon={<BookOpen className="size-5" />} title="Lesson not found" action={<Button onClick={() => navigate("/practice")}>Back to Practice</Button>} />;

  const ordered = siblings.data ?? [];
  const idx = ordered.findIndex((x) => x.id === l.id);
  const prev = idx > 0 ? ordered[idx - 1] : undefined;
  const next = idx >= 0 ? ordered[idx + 1] : undefined;
  const qs = questions.data ?? [];

  const toggleComplete = async () => {
    await setLessonCompleted(l.id, !l.completedAt);
    await client.invalidateQueries();
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1.5">
            <Link to={`/practice/tracks/${l.trackId}`} className="hover:text-fg">
              {l.trackTitle}
            </Link>
            / {l.subjectName}
          </span>
        }
        title={l.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">
              Level {l.level} · {LEVEL_LABELS[l.level]}
            </Badge>
            {l.estimatedMinutes && (
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden /> {formatDuration(l.estimatedMinutes)}
              </span>
            )}
            {l.topicName && <span>Topic: {l.topicName}</span>}
          </span>
        }
        actions={
          <>
            <Button variant={l.completedAt ? "secondary" : "primary"} icon={<CheckCircle2 className="size-4" />} onClick={() => void toggleComplete()}>
              {l.completedAt ? "Completed" : "Mark complete"}
            </Button>
            <IconButton label="Edit lesson" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Delete lesson" onClick={() => remove.ask(l)}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        }
      />

      <div className="grid grid-cols-[1fr_20rem] items-start gap-6">
        <Card className="p-6">
          {l.summary && <p className="mb-4 text-sm text-muted">{l.summary}</p>}
          {l.content.trim() ? <LessonContent source={l.content} /> : <p className="text-sm text-subtle">No content yet. Use Edit to write the explanation and examples.</p>}
          <div className="mt-8 flex justify-between border-t border-border pt-4">
            {prev ? (
              <Link to={`/practice/lessons/${prev.id}`} className="flex items-center gap-1 text-sm text-muted hover:text-accent">
                <ChevronLeft className="size-4" /> {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link to={`/practice/lessons/${next.id}`} className="flex items-center gap-1 text-sm text-muted hover:text-accent">
                {next.title} <ChevronRight className="size-4" />
              </Link>
            )}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          {milestoneCount > 0 && <StartProjectCard lessonId={l.id} milestoneCount={milestoneCount} />}
          <Card>
            <CardHeader title="Exercises & quiz" action={<Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAddingQuestion(true)}>Add</Button>} />
            {qs.length === 0 ? (
              <p className="px-4 pb-4 text-[13px] text-subtle">No exercises yet.</p>
            ) : (
              <>
                <ul className="px-4 pb-2 text-xs text-muted">
                  {Object.entries(qs.reduce<Record<string, number>>((m, q) => ({ ...m, [q.type]: (m[q.type] ?? 0) + 1 }), {})).map(([type, n]) => (
                    <li key={type}>
                      {n} × {QUESTION_TYPE_LABELS[type as keyof typeof QUESTION_TYPE_LABELS]}
                    </li>
                  ))}
                </ul>
                <div className="px-4 pb-4">
                  <Button variant="primary" className="w-full" icon={<Play className="size-4" />} onClick={() => navigate(`/practice/quiz?lesson=${l.id}&kind=lesson&count=all&title=${encodeURIComponent(l.title)}`)}>
                    Start exercises ({qs.length})
                  </Button>
                </div>
              </>
            )}
          </Card>
          <Card>
            <CardHeader title="Flashcards" icon={<Layers className="size-3.5" />} action={<Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAddingCard(true)}>Add</Button>} />
            {(cards.data ?? []).length === 0 ? (
              <p className="px-4 pb-4 text-[13px] text-subtle">No flashcards for this lesson.</p>
            ) : (
              <div className="px-4 pb-4">
                <p className="mb-2 text-xs text-muted">{cards.data!.length} cards</p>
                <Button className="w-full" onClick={() => navigate(`/flashcards/review?lesson=${l.id}`)}>
                  Review cards
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>

      <LessonForm open={editing} onClose={() => setEditing(false)} subjects={subjects.data ?? []} lesson={l} />
      <QuestionForm open={addingQuestion} onClose={() => setAddingQuestion(false)} defaults={questionDefaults} />
      <FlashcardForm open={addingCard} onClose={() => setAddingCard(false)} defaults={cardDefaults} />
      <ConfirmDialog open={remove.target != null} title="Delete lesson?" busy={remove.busy} error={remove.error} onClose={remove.cancel} onConfirm={remove.confirm} message={<p>“{l.title}” will be removed. Its questions and flashcards stay in the bank.</p>} />
    </>
  );
}
