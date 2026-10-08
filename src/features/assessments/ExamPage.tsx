import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, Brain, Layers, Sigma, CalendarClock, ListChecks, MapPin, Pencil, Sparkles, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader, EmptyState, ErrorState, ProgressBar, Spinner, Stat } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { Checklist } from "@/components/Checklist";
import { useExam, useLectures, useNotes } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { percentOf } from "@/domain/assessment";
import { daysUntil } from "@/domain/tracking";
import { dateOf, formatDuration, nowLocal, timeOf } from "@/domain/time";
import { formatDate } from "@/domain/dates";
import { ASSESSMENT_LABELS, deleteExam, setExamTopics, type Exam } from "@/services/assessments";
import { AttachmentList } from "@/features/attachments/AttachmentList";
import { RevisionSelect, lectureLabel } from "@/features/lectures/lectureUi";
import { NoteList } from "@/features/notes/NoteList";
import { ExamForm } from "./AssessmentForms";
import { TagPicker } from "@/components/TagPicker";
import { PlannerDialog } from "./PlannerDialog";
import { AiPlanDialog } from "@/features/ai/AiPlanDialog";
import { useAiEnabled } from "@/features/ai/AiParts";

const REVISION_ORDER = { not_reviewed: 0, needs_review: 1, reviewed: 2, mastered: 3 } as const;

export default function ExamPage() {
  const { examId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const exam = useExam(examId);
  const lectures = useLectures(exam.data?.courseId ?? "");
  const notes = useNotes({ courseId: exam.data?.courseId ?? "__none__", limit: 6 });
  const [editing, setEditing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [aiPlanning, setAiPlanning] = useState(false);
  const aiEnabled = useAiEnabled();
  const remove = useConfirmAction(
    (e: Exam) => deleteExam(e.id),
    (e) => navigate(`/studies/courses/${e.courseId}?tab=exams`),
  );

  if (exam.isPending) return <Spinner />;
  if (exam.error) return <ErrorState error={exam.error} />;
  const e = exam.data;
  if (!e) return <EmptyState icon={<CalendarClock className="size-5" />} title="Exam not found" action={<Button onClick={() => navigate(-1)}>Go back</Button>} />;

  const now = nowLocal();
  const days = e.startAt ? daysUntil(e.startAt, now) : null;
  const revised = e.topics.filter((t) => t.done).length;
  const percent = percentOf(e.score, e.maxScore);
  const lectureList = [...(lectures.data ?? [])].sort((a, b) => REVISION_ORDER[a.revisionStatus] - REVISION_ORDER[b.revisionStatus] || (a.number ?? 0) - (b.number ?? 0));

  const saveTopics = async (topics: typeof e.topics) => {
    await setExamTopics(e.id, topics);
    await client.invalidateQueries({ queryKey: ["exam", e.id] });
    await client.invalidateQueries({ queryKey: ["exams"] });
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to={`/studies/courses/${e.courseId}?tab=exams`} className="hover:text-fg">
            {e.courseCode ? `${e.courseCode} · ${e.courseName}` : e.courseName} / Exams
          </Link>
        }
        title={e.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {ASSESSMENT_LABELS.examKind[e.kind]}
            {e.startAt && (
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3.5" aria-hidden />
                {formatDate(dateOf(e.startAt), { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {timeOf(e.startAt)}
                {e.durationMinutes && ` (${formatDuration(e.durationMinutes)})`}
              </span>
            )}
            {e.location && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden /> {e.location}
              </span>
            )}
          </span>
        }
        actions={
          <>
            {aiEnabled && (
              <Button icon={<Sparkles className="size-4 text-accent" />} onClick={() => setAiPlanning(true)}>
                AI plan
              </Button>
            )}
            <Button variant="primary" icon={<CalendarClock className="size-4" />} onClick={() => setPlanning(true)} disabled={!e.startAt || (days != null && days < 1)}>
              Plan revision
            </Button>
            <IconButton label="Edit exam" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Delete exam" onClick={() => remove.ask(e)}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        }
      />

      <div className="-mt-3 mb-5">
        <TagPicker type="exam" id={e.id} />
      </div>
      <Card className="mb-6 grid grid-cols-4 gap-6 p-5">
        <Stat
          label="Countdown"
          value={days == null ? "No date" : days > 0 ? `${days} day${days === 1 ? "" : "s"}` : days === 0 ? "Today" : "Done"}
          sub={days != null && days > 0 ? "remaining" : undefined}
        />
        <div className="flex flex-col justify-center gap-2">
          <span className="text-xs text-muted">Topics revised</span>
          <span className="text-xl font-semibold tabular-nums">{e.topics.length ? `${revised} / ${e.topics.length}` : "—"}</span>
          {e.topics.length > 0 && <ProgressBar value={revised / e.topics.length} label="Topics revised" />}
        </div>
        <Stat label="Weight" value={e.weight != null ? `${e.weight}%` : "—"} sub="of the course grade" />
        <Stat label="Result" value={percent != null ? `${percent.toFixed(1)}%` : "—"} sub={e.score != null ? `${e.score} / ${e.maxScore}` : "Not graded yet"} />
      </Card>

      <div className="grid grid-cols-[1fr_22rem] items-start gap-6">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Revision topics" icon={<ListChecks className="size-3.5" />} />
            <div className="px-3 pb-3">
              <Checklist items={e.topics} onChange={(t) => void saveTopics(t)} placeholder="Add a topic and press Enter (e.g. Backpropagation)" />
            </div>
          </Card>

          <Card>
            <CardHeader title="Lectures to revise" icon={<BookOpenCheck className="size-3.5" />} />
            {lectureList.length === 0 ? (
              <p className="px-4 pb-4 text-[13px] text-subtle">No lectures recorded for this course yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {lectureList.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-2">
                    <Link to={`/studies/lectures/${l.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-accent">
                      {lectureLabel(l)}
                    </Link>
                    <RevisionSelect lecture={l} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Course notes" action={<Link to={`/studies/courses/${e.courseId}?tab=notes`} className="text-xs text-accent hover:underline">All notes</Link>} />
            {(notes.data ?? []).length === 0 ? <p className="px-4 pb-4 text-[13px] text-subtle">No notes for this course yet.</p> : <NoteList notes={notes.data ?? []} />}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {e.notes && (
            <Card>
              <CardHeader title="Notes" />
              <p className="px-4 pb-4 text-sm whitespace-pre-wrap text-muted">{e.notes}</p>
            </Card>
          )}
          <Card>
            <CardHeader title="Practise" />
            <div className="flex flex-col gap-2 px-4 pb-4">
              <Button icon={<Layers className="size-4" />} onClick={() => navigate(`/flashcards/review?course=${e.courseId}`)}>
                Review course flashcards
              </Button>
              <Button icon={<Brain className="size-4" />} onClick={() => navigate(`/practice/quiz?course=${e.courseId}&kind=exam&title=${encodeURIComponent(`${e.title} practice`)}`)}>
                Practice exam questions
              </Button>
              <Button icon={<Sigma className="size-4" />} onClick={() => navigate(`/studies/courses/${e.courseId}?tab=practice`)}>
                Formula sheet
              </Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Files" />
            <div className="px-2 pb-2">
              <AttachmentList owner={{ type: "exam", id: e.id }} onView={(a) => navigate(`/files/${a.id}`)} compact />
            </div>
            <p className="px-4 pb-3 text-xs text-subtle">Past papers, formula sheets, the exam syllabus…</p>
          </Card>
        </div>
      </div>

      <ExamForm open={editing} onClose={() => setEditing(false)} courseId={e.courseId} exam={e} />
      <PlannerDialog open={planning} onClose={() => setPlanning(false)} exam={e} lectures={lectures.data ?? []} />
      <AiPlanDialog open={aiPlanning} onClose={() => setAiPlanning(false)} exam={e} />
      <ConfirmDialog open={remove.target != null} title="Delete exam?" busy={remove.busy} error={remove.error} onClose={remove.cancel} onConfirm={remove.confirm} message={<p>“{e.title}” and its files will be removed.</p>} />
    </>
  );
}
