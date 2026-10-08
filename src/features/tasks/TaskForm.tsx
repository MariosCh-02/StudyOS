import { useEffect, useState } from "react";
import { FormModal } from "@/components/ui/Modal";
import { numberToInput, parseOptionalNumber, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { useAllCourses, useAssignments, useProjects, useSaveMutation } from "@/hooks/queries";
import { dateOf, joinDateTime, timeOf } from "@/domain/time";
import { createTask, TASK_LABELS, TASK_PRIORITIES, TASK_STATUSES, updateTask, type Task, type TaskInput } from "@/services/tracking";

interface Props {
  open: boolean;
  onClose: () => void;
  task?: Task;
  defaults?: Partial<TaskInput>;
}

interface FormState {
  title: string;
  notes: string;
  courseId: string;
  assignmentId: string;
  projectId: string;
  dueDate: string;
  dueTime: string;
  priority: TaskInput["priority"];
  status: TaskInput["status"];
  estimate: string;
}

const toState = (t?: Task, d?: Partial<TaskInput>): FormState => ({
  title: t?.title ?? d?.title ?? "",
  notes: t?.notes ?? "",
  courseId: t?.courseId ?? d?.courseId ?? "",
  assignmentId: t?.assignmentId ?? d?.assignmentId ?? "",
  projectId: t?.projectId ?? d?.projectId ?? "",
  dueDate: t?.dueAt ? dateOf(t.dueAt) : (d?.dueAt ? dateOf(d.dueAt) : ""),
  dueTime: t?.dueAt ? timeOf(t.dueAt) : "23:59",
  priority: t?.priority ?? d?.priority ?? "medium",
  status: t?.status ?? "todo",
  estimate: numberToInput(t?.estimatedMinutes),
});

export function TaskForm({ open, onClose, task, defaults }: Props) {
  const courses = useAllCourses();
  const [form, setForm] = useState<FormState>(() => toState(task, defaults));
  const assignments = useAssignments({ courseId: form.courseId || undefined });
  const projects = useProjects();
  const save = useSaveMutation((input: TaskInput) => (task ? updateTask(task.id, input) : createTask(input)), onClose);

  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(toState(task, defaults));
  }, [open, task, defaults]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const e = save.fieldErrors;

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={task ? "Edit task" : "New task"}
      submitLabel={task ? "Save" : "Add task"}
      submitting={save.isPending}
      formError={save.formError}
      onSubmit={() =>
        save.mutate({
          title: form.title,
          notes: form.notes,
          courseId: form.courseId || null,
          assignmentId: form.assignmentId || null,
          projectId: form.projectId || null,
          dueAt: form.dueDate ? joinDateTime(form.dueDate, form.dueTime || "23:59") : null,
          priority: form.priority,
          status: form.status,
          estimatedMinutes: parseOptionalNumber(form.estimate),
        })
      }
    >
      <TextField label="Task" required autoFocus value={form.title} onChange={(ev) => set("title", ev.target.value)} error={e.title} />
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Course"
          value={form.courseId}
          onChange={(ev) => setForm((f) => ({ ...f, courseId: ev.target.value, assignmentId: "" }))}
          options={[{ value: "", label: "None" }, ...(courses.data ?? []).map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))]}
        />
        <SelectField
          label="Assignment"
          value={form.assignmentId}
          onChange={(ev) => set("assignmentId", ev.target.value)}
          options={[{ value: "", label: "None" }, ...(assignments.data ?? []).map((a) => ({ value: a.id, label: a.title }))]}
        />
      </div>
      <SelectField
        label="Project"
        value={form.projectId}
        onChange={(ev) => set("projectId", ev.target.value)}
        options={[
          { value: "", label: "None" },
          ...(projects.data ?? []).filter((p) => p.status !== "cancelled" || p.id === form.projectId).map((p) => ({ value: p.id, label: p.title })),
        ]}
      />
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <TextField label="Due date" type="date" value={form.dueDate} onChange={(ev) => set("dueDate", ev.target.value)} error={e.dueAt} />
        <TextField label="Time" type="time" value={form.dueTime} disabled={!form.dueDate} onChange={(ev) => set("dueTime", ev.target.value)} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <SelectField label="Priority" value={form.priority} onChange={(ev) => set("priority", ev.target.value as FormState["priority"])} options={TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_LABELS.priority[p] }))} />
        <SelectField label="Status" value={form.status} onChange={(ev) => set("status", ev.target.value as FormState["status"])} options={TASK_STATUSES.map((s) => ({ value: s, label: TASK_LABELS.status[s] }))} />
        <TextField label="Estimate (min)" inputMode="numeric" value={form.estimate} onChange={(ev) => set("estimate", ev.target.value)} error={e.estimatedMinutes} />
      </div>
      <TextAreaField label="Notes" value={form.notes} onChange={(ev) => set("notes", ev.target.value)} />
    </FormModal>
  );
}
