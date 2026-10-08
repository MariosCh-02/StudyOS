import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Clock, Timer } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Feedback";
import { describeDue } from "@/domain/tracking";
import { formatDuration, nowLocal } from "@/domain/time";
import { setTaskStatus, TASK_LABELS, type Task } from "@/services/tracking";
import { useTimer } from "@/features/study/TimerProvider";
import { TIMER_MODES } from "@/features/study/timerMachine";
import { TaskForm } from "./TaskForm";

const PRIORITY_TONE = { low: "neutral", medium: "neutral", high: "warning", urgent: "danger" } as const;

export function TaskRow({ task, onEdit }: { task: Task; onEdit: (t: Task) => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const timer = useTimer();
  const now = nowLocal();
  const done = task.status === "done";
  const overdue = !done && task.dueAt != null && task.dueAt < now;

  const toggle = async () => {
    await setTaskStatus(task.id, done ? "todo" : "done");
    await client.invalidateQueries();
  };

  const study = () => {
    if (timer.state.status === "idle") {
      timer.start(TIMER_MODES[0]!, { courseId: task.courseId, programmeId: null, topic: task.title, taskId: task.id });
    }
    navigate("/study");
  };

  return (
    <li className="group flex items-center gap-3 px-4 py-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        onClick={() => void toggle()}
        className={clsx(
          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          done ? "border-success bg-success text-white" : "border-border hover:border-accent",
        )}
      >
        {done && <Check className="size-3" />}
      </button>
      <button type="button" onClick={() => onEdit(task)} className="min-w-0 flex-1 text-left">
        <span className={clsx("block truncate text-sm", done && "text-subtle line-through")}>{task.title}</span>
        <span className="flex items-center gap-2 text-xs text-subtle">
          {task.courseName && (
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ background: task.courseColor ?? "var(--subtle)" }} />
              {task.courseCode ?? task.courseName}
            </span>
          )}
          {task.projectTitle && <span className="max-w-40 truncate">{task.projectTitle}</span>}
          {task.dueAt && !done && <span className={overdue ? "text-danger" : undefined}>{describeDue(task.dueAt, now)}</span>}
          {task.estimatedMinutes && (
            <span className="flex items-center gap-0.5">
              <Clock className="size-3" aria-hidden />
              {formatDuration(task.estimatedMinutes)}
            </span>
          )}
          {task.status === "in_progress" && <span className="text-accent">In progress</span>}
        </span>
      </button>
      {!done && task.priority !== "medium" && <Badge tone={PRIORITY_TONE[task.priority]}>{TASK_LABELS.priority[task.priority]}</Badge>}
      {!done && (
        <IconButton label={`Study for "${task.title}"`} onClick={study} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
          <Timer className="size-3.5" />
        </IconButton>
      )}
    </li>
  );
}

/** A list of tasks with inline completion and an edit dialog. */
export function TaskList({ tasks }: { tasks: Task[] }) {
  const [editing, setEditing] = useState<Task | null>(null);
  return (
    <>
      <ul className="divide-y divide-border">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} onEdit={setEditing} />
        ))}
      </ul>
      <TaskForm open={editing != null} task={editing ?? undefined} onClose={() => setEditing(null)} />
    </>
  );
}
