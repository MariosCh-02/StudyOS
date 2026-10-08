import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ClipboardList, ListChecks, Pencil, Plus, Timer, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader, EmptyState, ErrorState, ProgressBar, Spinner, Stat } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { SelectField } from "@/components/ui/Field";
import { Checklist } from "@/components/Checklist";
import { useAssignment, useTasks } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { percentOf } from "@/domain/assessment";
import { describeDue } from "@/domain/tracking";
import { dateOf, nowLocal, timeOf } from "@/domain/time";
import { formatDate } from "@/domain/dates";
import { ASSESSMENT_LABELS, ASSIGNMENT_STATUSES, deleteAssignment, patchAssignment, updateAssignment, type Assignment, type AssignmentStatus } from "@/services/assessments";
import { AttachmentList } from "@/features/attachments/AttachmentList";
import { TaskForm } from "@/features/tasks/TaskForm";
import { TaskList } from "@/features/tasks/TaskList";
import { useTimer } from "@/features/study/TimerProvider";
import { TIMER_MODES } from "@/features/study/timerMachine";
import { AssignmentForm } from "./AssessmentForms";
import { TagPicker } from "@/components/TagPicker";

function NotesBox({ assignment }: { assignment: Assignment }) {
  const client = useQueryClient();
  const [text, setText] = useState(assignment.notes ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  useEffect(() => {
    setText(assignment.notes ?? "");
  }, [assignment.id]);
  const dirty = text !== (assignment.notes ?? "");
  const save = async () => {
    setState("saving");
    await updateAssignment(assignment.id, { ...assignment, notes: text });
    await client.invalidateQueries({ queryKey: ["assignment", assignment.id] });
    setState("saved");
  };
  return (
    <Card>
      <CardHeader title="Notes" action={dirty ? <Button size="sm" variant="ghost" loading={state === "saving"} onClick={() => void save()}>Save</Button> : state === "saved" ? <span className="text-xs text-success">Saved</span> : null} />
      <textarea
        aria-label="Assignment notes"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setState("idle");
        }}
        onBlur={() => dirty && void save()}
        rows={5}
        placeholder="Approach, questions for the lecturer, feedback received…"
        className="mx-4 mb-4 w-[calc(100%-2rem)] resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-subtle focus:border-accent focus:outline-none"
      />
    </Card>
  );
}

export default function AssignmentPage() {
  const { assignmentId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const timer = useTimer();
  const assignment = useAssignment(assignmentId);
  const tasks = useTasks({ courseId: assignment.data?.courseId });
  const [editing, setEditing] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const remove = useConfirmAction(
    (a: Assignment) => deleteAssignment(a.id),
    (a) => navigate(`/studies/courses/${a.courseId}?tab=assignments`),
  );
  const a = assignment.data;
  const taskDefaults = useMemo(() => (a ? { courseId: a.courseId, assignmentId: a.id, dueAt: a.dueAt } : undefined), [a?.id, a?.courseId, a?.dueAt]);

  if (assignment.isPending) return <Spinner />;
  if (assignment.error) return <ErrorState error={assignment.error} />;
  if (!a) return <EmptyState icon={<ClipboardList className="size-5" />} title="Assignment not found" action={<Button onClick={() => navigate(-1)}>Go back</Button>} />;

  const now = nowLocal();
  const linkedTasks = (tasks.data ?? []).filter((t) => t.assignmentId === a.id);
  const percent = percentOf(a.score, a.maxScore);
  const steps = a.checklist.filter((c) => c.done).length;

  const patch = async (p: Parameters<typeof patchAssignment>[1]) => {
    await patchAssignment(a.id, p);
    await client.invalidateQueries();
  };

  const study = () => {
    if (timer.state.status === "idle") timer.start(TIMER_MODES[0]!, { courseId: a.courseId, programmeId: null, topic: a.title, taskId: null });
    navigate("/study");
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to={`/studies/courses/${a.courseId}?tab=assignments`} className="hover:text-fg">
            {a.courseCode ? `${a.courseCode} · ${a.courseName}` : a.courseName} / Assignments
          </Link>
        }
        title={a.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {ASSESSMENT_LABELS.assignmentKind[a.kind]}
            {a.dueAt && (
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3.5" aria-hidden />
                Due {formatDate(dateOf(a.dueAt), { weekday: "long", day: "numeric", month: "long" })} at {timeOf(a.dueAt)}
                {(a.status === "not_started" || a.status === "in_progress") && <span className={a.dueAt < now ? "text-danger" : "text-accent"}> · {describeDue(a.dueAt, now)}</span>}
              </span>
            )}
          </span>
        }
        actions={
          <>
            <SelectField
              label="Status"
              className="w-40 [&_label]:sr-only"
              value={a.status}
              onChange={(e) => void patch({ status: e.target.value as AssignmentStatus })}
              options={ASSIGNMENT_STATUSES.map((s) => ({ value: s, label: ASSESSMENT_LABELS.assignmentStatus[s] }))}
            />
            <Button icon={<Timer className="size-4" />} onClick={study}>
              Work on it
            </Button>
            <IconButton label="Edit assignment" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Delete assignment" onClick={() => remove.ask(a)}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        }
      />

      <div className="-mt-3 mb-5">
        <TagPicker type="assignment" id={a.id} />
      </div>
      <Card className="mb-6 grid grid-cols-3 gap-6 p-5">
        <div className="flex flex-col justify-center gap-2">
          <span className="text-xs text-muted">Progress</span>
          <span className="text-xl font-semibold tabular-nums">{a.checklist.length ? `${steps} / ${a.checklist.length} steps` : ASSESSMENT_LABELS.assignmentStatus[a.status]}</span>
          {a.checklist.length > 0 && <ProgressBar value={steps / a.checklist.length} label="Checklist progress" />}
        </div>
        <Stat label="Weight" value={a.weight != null ? `${a.weight}%` : "—"} sub="of the course grade" />
        <Stat label="Grade" value={percent != null ? `${percent.toFixed(1)}%` : "—"} sub={a.score != null ? `${a.score} / ${a.maxScore}` : "Not graded yet (Edit to enter it)"} />
      </Card>

      <div className="grid grid-cols-[1fr_22rem] items-start gap-6">
        <div className="flex flex-col gap-5">
          {a.description && (
            <Card>
              <CardHeader title="Brief" />
              <p className="px-4 pb-4 text-sm whitespace-pre-wrap">{a.description}</p>
            </Card>
          )}
          <Card>
            <CardHeader title="Checklist" icon={<ListChecks className="size-3.5" />} />
            <div className="px-3 pb-3">
              <Checklist items={a.checklist} onChange={(checklist) => void patch({ checklist })} placeholder="Add a step and press Enter (e.g. Write introduction)" />
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Tasks"
              action={
                <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAddingTask(true)}>
                  Add task
                </Button>
              }
            />
            {linkedTasks.length === 0 ? <p className="px-4 pb-4 text-[13px] text-subtle">Break the work into tasks with their own deadlines and time estimates.</p> : <TaskList tasks={linkedTasks} />}
          </Card>
        </div>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Files" />
            <div className="px-2 pb-2">
              <AttachmentList owner={{ type: "assignment", id: a.id }} onView={(f) => navigate(`/files/${f.id}`)} compact />
            </div>
          </Card>
          <NotesBox assignment={a} />
        </div>
      </div>

      <AssignmentForm open={editing} onClose={() => setEditing(false)} courseId={a.courseId} assignment={a} />
      <TaskForm open={addingTask} onClose={() => setAddingTask(false)} defaults={taskDefaults} />
      <ConfirmDialog open={remove.target != null} title="Delete assignment?" busy={remove.busy} error={remove.error} onClose={remove.cancel} onConfirm={remove.confirm} message={<p>“{a.title}” and its files will be removed. Linked tasks are kept.</p>} />
    </>
  );
}
