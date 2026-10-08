import { useEffect, useState } from "react";
import { FormModal } from "@/components/ui/Modal";
import { numberToInput, parseOptionalNumber, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { useSaveMutation } from "@/hooks/queries";
import { dateOf, joinDateTime, timeOf } from "@/domain/time";
import {
  ASSESSMENT_LABELS,
  ASSIGNMENT_KINDS,
  ASSIGNMENT_STATUSES,
  createAssignment,
  createExam,
  EXAM_KINDS,
  updateAssignment,
  updateExam,
  type Assignment,
  type AssignmentInput,
  type Exam,
  type ExamInput,
} from "@/services/assessments";

function GradeFields({ weight, score, maxScore, onChange, errors }: {
  weight: string;
  score: string;
  maxScore: string;
  onChange: (k: "weight" | "score" | "maxScore", v: string) => void;
  errors: Record<string, string>;
}) {
  return (
    <fieldset className="grid grid-cols-3 gap-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-[13px] font-medium text-muted">Grading</legend>
      <TextField label="Weight (% of course)" inputMode="decimal" placeholder="e.g. 20" value={weight} onChange={(e) => onChange("weight", e.target.value)} error={errors.weight} />
      <TextField label="Score" inputMode="decimal" placeholder="e.g. 17" value={score} onChange={(e) => onChange("score", e.target.value)} error={errors.score} />
      <TextField label="Out of" inputMode="decimal" placeholder="e.g. 20" value={maxScore} onChange={(e) => onChange("maxScore", e.target.value)} error={errors.maxScore} />
    </fieldset>
  );
}

// -------------------------------------------------------------- assignment

interface AssignmentFormProps {
  open: boolean;
  onClose: () => void;
  courseId: string;
  assignment?: Assignment;
  onSaved?: (a: Assignment) => void;
}

export function AssignmentForm({ open, onClose, courseId, assignment, onSaved }: AssignmentFormProps) {
  const init = () => ({
    title: assignment?.title ?? "",
    kind: assignment?.kind ?? ("assignment" as AssignmentInput["kind"]),
    description: assignment?.description ?? "",
    dueDate: assignment?.dueAt ? dateOf(assignment.dueAt) : "",
    dueTime: assignment?.dueAt ? timeOf(assignment.dueAt) : "23:59",
    status: assignment?.status ?? ("not_started" as AssignmentInput["status"]),
    weight: numberToInput(assignment?.weight),
    score: numberToInput(assignment?.score),
    maxScore: numberToInput(assignment?.maxScore ?? 100),
  });
  const [form, setForm] = useState(init);
  const save = useSaveMutation(
    (input: AssignmentInput) => (assignment ? updateAssignment(assignment.id, input) : createAssignment(input)),
    (a) => {
      onSaved?.(a);
      onClose();
    },
  );
  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(init());
  }, [open, assignment]);

  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) => setForm((f) => ({ ...f, [k]: v }));
  const e = save.fieldErrors;
  const submit = () =>
    save.mutate({
      courseId,
      title: form.title,
      kind: form.kind,
      description: form.description,
      dueAt: form.dueDate ? joinDateTime(form.dueDate, form.dueTime || "23:59") : null,
      weight: parseOptionalNumber(form.weight),
      status: form.status,
      score: parseOptionalNumber(form.score),
      maxScore: form.score.trim() ? parseOptionalNumber(form.maxScore) : null,
      checklist: assignment?.checklist ?? [],
      notes: assignment?.notes ?? null,
    });

  return (
    <FormModal open={open} onClose={onClose} width="lg" title={assignment ? "Edit assignment" : "New assignment"} submitLabel={assignment ? "Save" : "Add assignment"} submitting={save.isPending} formError={save.formError} onSubmit={submit}>
      <div className="grid grid-cols-[1fr_10rem] gap-3">
        <TextField label="Name" required autoFocus value={form.title} onChange={(ev) => set("title", ev.target.value)} error={e.title} placeholder="e.g. Assignment 1 — Linear regression" />
        <SelectField label="Type" value={form.kind} onChange={(ev) => set("kind", ev.target.value as typeof form.kind)} options={ASSIGNMENT_KINDS.map((k) => ({ value: k, label: ASSESSMENT_LABELS.assignmentKind[k] }))} />
      </div>
      <div className="grid grid-cols-[1fr_7rem_1fr] gap-3">
        <TextField label="Due date" type="date" value={form.dueDate} onChange={(ev) => set("dueDate", ev.target.value)} error={e.dueAt} hint="Shown on your calendar" />
        <TextField label="Time" type="time" value={form.dueTime} disabled={!form.dueDate} onChange={(ev) => set("dueTime", ev.target.value)} />
        <SelectField label="Status" value={form.status} onChange={(ev) => set("status", ev.target.value as typeof form.status)} options={ASSIGNMENT_STATUSES.map((s) => ({ value: s, label: ASSESSMENT_LABELS.assignmentStatus[s] }))} />
      </div>
      <GradeFields weight={form.weight} score={form.score} maxScore={form.maxScore} onChange={(k, v) => set(k, v)} errors={e} />
      <TextAreaField label="Description" rows={4} value={form.description} onChange={(ev) => set("description", ev.target.value)} />
    </FormModal>
  );
}

// -------------------------------------------------------------------- exam

interface ExamFormProps {
  open: boolean;
  onClose: () => void;
  courseId: string;
  exam?: Exam;
  onSaved?: (e: Exam) => void;
}

export function ExamForm({ open, onClose, courseId, exam, onSaved }: ExamFormProps) {
  const init = () => ({
    title: exam?.title ?? "",
    kind: exam?.kind ?? ("final" as ExamInput["kind"]),
    date: exam?.startAt ? dateOf(exam.startAt) : "",
    time: exam?.startAt ? timeOf(exam.startAt) : "09:00",
    duration: numberToInput(exam?.durationMinutes ?? 120),
    location: exam?.location ?? "",
    weight: numberToInput(exam?.weight),
    score: numberToInput(exam?.score),
    maxScore: numberToInput(exam?.maxScore ?? 100),
    notes: exam?.notes ?? "",
  });
  const [form, setForm] = useState(init);
  const save = useSaveMutation(
    (input: ExamInput) => (exam ? updateExam(exam.id, input) : createExam(input)),
    (x) => {
      onSaved?.(x);
      onClose();
    },
  );
  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(init());
  }, [open, exam]);

  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) => setForm((f) => ({ ...f, [k]: v }));
  const e = save.fieldErrors;
  const submit = () =>
    save.mutate({
      courseId,
      title: form.title,
      kind: form.kind,
      startAt: form.date ? joinDateTime(form.date, form.time || "09:00") : null,
      durationMinutes: parseOptionalNumber(form.duration),
      location: form.location,
      topics: exam?.topics ?? [],
      notes: form.notes,
      weight: parseOptionalNumber(form.weight),
      score: parseOptionalNumber(form.score),
      maxScore: form.score.trim() ? parseOptionalNumber(form.maxScore) : null,
    });

  return (
    <FormModal open={open} onClose={onClose} width="lg" title={exam ? "Edit exam" : "New exam"} submitLabel={exam ? "Save" : "Add exam"} submitting={save.isPending} formError={save.formError} onSubmit={submit}>
      <div className="grid grid-cols-[1fr_10rem] gap-3">
        <TextField label="Name" required autoFocus value={form.title} onChange={(ev) => set("title", ev.target.value)} error={e.title} placeholder="e.g. Machine Learning — Final" />
        <SelectField label="Type" value={form.kind} onChange={(ev) => set("kind", ev.target.value as typeof form.kind)} options={EXAM_KINDS.map((k) => ({ value: k, label: ASSESSMENT_LABELS.examKind[k] }))} />
      </div>
      <div className="grid grid-cols-[1fr_7rem_8rem] gap-3">
        <TextField label="Date" type="date" value={form.date} onChange={(ev) => set("date", ev.target.value)} error={e.startAt} />
        <TextField label="Time" type="time" value={form.time} onChange={(ev) => set("time", ev.target.value)} />
        <TextField label="Duration (min)" inputMode="numeric" value={form.duration} onChange={(ev) => set("duration", ev.target.value)} error={e.durationMinutes} />
      </div>
      <TextField label="Location" value={form.location} onChange={(ev) => set("location", ev.target.value)} />
      <GradeFields weight={form.weight} score={form.score} maxScore={form.maxScore} onChange={(k, v) => set(k, v)} errors={e} />
      <TextAreaField label="Notes" value={form.notes} onChange={(ev) => set("notes", ev.target.value)} />
    </FormModal>
  );
}
