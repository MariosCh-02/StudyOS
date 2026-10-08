import { useEffect, useState } from "react";
import { FormModal } from "@/components/ui/Modal";
import { numberToInput, parseOptionalNumber, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { ColorPicker, GradeInput } from "@/components/ui/Pickers";
import { useAcademicYears, useSaveMutation, useSemesters } from "@/hooks/queries";
import { COURSE_STATUSES, LABELS, type Course, type CourseInput } from "@/domain/types";
import type { ProgrammeWithInstitution } from "@/services/programmes";
import { createCourse, updateCourse } from "@/services/courses";

interface Props {
  open: boolean;
  onClose: () => void;
  programme: ProgrammeWithInstitution;
  course?: Course;
  defaultSemesterId?: string | null;
  onSaved?: (c: Course) => void;
}

interface FormState {
  semesterId: string;
  name: string;
  code: string;
  credits: string;
  lecturer: string;
  lecturerEmail: string;
  location: string;
  status: Course["status"];
  finalGrade: string;
  targetGrade: string;
  color: string | null;
  description: string;
}

const toState = (c: Course | undefined, semesterId: string | null | undefined): FormState => ({
  semesterId: c?.semesterId ?? semesterId ?? "",
  name: c?.name ?? "",
  code: c?.code ?? "",
  credits: numberToInput(c?.credits),
  lecturer: c?.lecturer ?? "",
  lecturerEmail: c?.lecturerEmail ?? "",
  location: c?.location ?? "",
  status: c?.status ?? "in_progress",
  finalGrade: numberToInput(c?.finalGrade),
  targetGrade: numberToInput(c?.targetGrade),
  color: c?.color ?? null,
  description: c?.description ?? "",
});

export function CourseForm({ open, onClose, programme, course, defaultSemesterId, onSaved }: Props) {
  const years = useAcademicYears(programme.id);
  const semesters = useSemesters(programme.id);
  const [form, setForm] = useState<FormState>(() => toState(course, defaultSemesterId));
  const save = useSaveMutation(
    (input: CourseInput) => (course ? updateCourse(course.id, input) : createCourse(input)),
    (saved) => {
      onSaved?.(saved);
      onClose();
    },
  );

  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(toState(course, defaultSemesterId));
  }, [open, course, defaultSemesterId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = () =>
    save.mutate({
      programmeId: programme.id,
      semesterId: form.semesterId || null,
      name: form.name,
      code: form.code,
      credits: parseOptionalNumber(form.credits),
      lecturer: form.lecturer,
      lecturerEmail: form.lecturerEmail,
      location: form.location,
      status: form.status,
      finalGrade: parseOptionalNumber(form.finalGrade),
      targetGrade: parseOptionalNumber(form.targetGrade),
      color: form.color,
      description: form.description,
    });

  const yearLabel = new Map((years.data ?? []).map((y) => [y.id, y.label]));
  const semesterOptions = [
    { value: "", label: "Not assigned to a semester" },
    ...(semesters.data ?? []).map((s) => ({ value: s.id, label: `${yearLabel.get(s.academicYearId) ?? ""} · ${s.label}` })),
  ];
  const e = save.fieldErrors;
  const scale = programme.gradingScale;

  return (
    <FormModal
      open={open}
      onClose={onClose}
      width="lg"
      title={course ? "Edit course" : "New course"}
      submitLabel={course ? "Save" : "Create course"}
      submitting={save.isPending}
      formError={save.formError}
      onSubmit={submit}
    >
      <div className="grid grid-cols-[1fr_9rem] gap-3">
        <TextField label="Course name" required autoFocus placeholder="e.g. Machine Learning" value={form.name} onChange={(ev) => set("name", ev.target.value)} error={e.name} />
        <TextField label="Code" placeholder="e.g. MAI611" value={form.code} onChange={(ev) => set("code", ev.target.value)} error={e.code} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <SelectField className="col-span-2" label="Semester" value={form.semesterId} onChange={(ev) => set("semesterId", ev.target.value)} options={semesterOptions} error={e.semesterId} />
        <TextField label={`Credits (${programme.creditUnit})`} inputMode="decimal" value={form.credits} onChange={(ev) => set("credits", ev.target.value)} error={e.credits} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <TextField label="Lecturer" value={form.lecturer} onChange={(ev) => set("lecturer", ev.target.value)} />
        <TextField label="Lecturer email" type="email" value={form.lecturerEmail} onChange={(ev) => set("lecturerEmail", ev.target.value)} error={e.lecturerEmail} />
        <TextField label="Room / location" value={form.location} onChange={(ev) => set("location", ev.target.value)} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <SelectField
          label="Status"
          value={form.status}
          onChange={(ev) => set("status", ev.target.value as FormState["status"])}
          options={COURSE_STATUSES.map((s) => ({ value: s, label: LABELS.courseStatus[s] }))}
        />
        <GradeInput label="Final grade" scale={scale} value={form.finalGrade} onChange={(v) => set("finalGrade", v)} error={e.finalGrade} />
        <GradeInput label="Target grade" scale={scale} value={form.targetGrade} onChange={(v) => set("targetGrade", v)} error={e.targetGrade} />
      </div>
      <ColorPicker value={form.color} onChange={(c) => set("color", c)} />
      <TextAreaField label="Description" value={form.description} onChange={(ev) => set("description", ev.target.value)} />
    </FormModal>
  );
}
