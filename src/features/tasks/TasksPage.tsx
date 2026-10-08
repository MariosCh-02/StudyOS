import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Card, EmptyState, ErrorState, Spinner } from "@/components/ui/Feedback";
import { useAllCourses, useTasks } from "@/hooks/queries";
import { addDays, dateOf, nowLocal } from "@/domain/time";
import { createTask, type Task } from "@/services/tracking";
import { TaskForm } from "./TaskForm";
import { TaskList } from "./TaskList";
import { ExportMenu } from "@/components/ExportMenu";
import { tasksExports } from "@/features/export/exportItems";

function group(tasks: Task[]) {
  const now = nowLocal();
  const today = dateOf(now);
  const week = addDays(today, 7);
  const g = { overdue: [] as Task[], today: [] as Task[], week: [] as Task[], later: [] as Task[], noDate: [] as Task[], done: [] as Task[] };
  for (const t of tasks) {
    if (t.status === "done") g.done.push(t);
    else if (!t.dueAt) g.noDate.push(t);
    else if (t.dueAt < now) g.overdue.push(t);
    else if (dateOf(t.dueAt) === today) g.today.push(t);
    else if (dateOf(t.dueAt) <= week) g.week.push(t);
    else g.later.push(t);
  }
  return g;
}

export default function TasksPage() {
  const client = useQueryClient();
  // Show completed tasks from the last 7 days.
  const since = useMemo(() => new Date(Date.now() - 7 * 86_400_000).toISOString(), []);
  const [courseId, setCourseId] = useState("");
  const tasks = useTasks({ doneSince: since, courseId: courseId || undefined });
  const courses = useAllCourses();
  const [quick, setQuick] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stable identity: the form resets whenever its defaults change.
  const defaults = useMemo(() => (courseId ? { courseId } : undefined), [courseId]);

  const quickAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!quick.trim()) return;
    setError(null);
    try {
      await createTask({ title: quick, notes: null, courseId: courseId || null, assignmentId: null, dueAt: null, priority: "medium", status: "todo", estimatedMinutes: null });
      setQuick("");
      await client.invalidateQueries({ queryKey: ["tasks"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (tasks.isPending) return <Spinner />;
  if (tasks.error) return <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />;
  const g = group(tasks.data);
  const sections: [string, Task[], string?][] = [
    ["Overdue", g.overdue, "text-danger"],
    ["Today", g.today],
    ["Next 7 days", g.week],
    ["Later", g.later],
    ["No due date", g.noDate],
    ["Done (last 7 days)", g.done, "text-subtle"],
  ];
  const open = tasks.data.length - g.done.length;

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle={`${open} open task${open === 1 ? "" : "s"}`}
        actions={
          <>
            <ExportMenu items={tasksExports()} />
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              New task
            </Button>
          </>
        }
      />
      <div className="mb-4 flex gap-3">
        <form onSubmit={(e) => void quickAdd(e)} className="flex-1">
          <label className="sr-only" htmlFor="quick-task">
            Quick add task
          </label>
          <input
            id="quick-task"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder="Add a task and press Enter…"
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </form>
        <select
          aria-label="Filter by course"
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          className="h-10 w-60 rounded-md border border-border bg-surface px-2 text-sm focus:border-accent focus:outline-none"
        >
          <option value="">All courses</option>
          {(courses.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.code ? `${c.code} · ${c.name}` : c.name}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      {tasks.data.length === 0 ? (
        <Card>
          <EmptyState icon={<CheckSquare className="size-5" />} title="No tasks" description="Type above to add one. Tasks can be linked to a course or an assignment, and you can start the study timer from any task." />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {sections
            .filter(([, list]) => list.length > 0)
            .map(([title, list, tone]) => (
              <Card key={title}>
                <h2 className={`px-4 pt-3 pb-1 text-xs font-semibold tracking-wide uppercase ${tone ?? "text-muted"}`}>
                  {title} · {list.length}
                </h2>
                <TaskList tasks={list} />
              </Card>
            ))}
        </div>
      )}
      <TaskForm open={adding} defaults={defaults} onClose={() => setAdding(false)} />
    </>
  );
}
