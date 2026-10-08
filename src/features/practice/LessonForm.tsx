import { useEffect, useState } from "react";
import { FormModal } from "@/components/ui/Modal";
import { numberToInput, parseOptionalNumber, SelectField, TextField } from "@/components/ui/Field";
import { MarkdownField } from "@/components/Markdown";
import { useSaveMutation } from "@/hooks/queries";
import { createLesson, LEVEL_LABELS, updateLesson, type Lesson, type LessonInput, type Subject } from "@/services/learning";

interface Props {
  open: boolean;
  onClose: () => void;
  subjects: Subject[];
  lesson?: Lesson;
  defaultSubjectId?: string;
  defaultLevel?: number;
}

export function LessonForm({ open, onClose, subjects, lesson, defaultSubjectId, defaultLevel }: Props) {
  const init = () => ({
    subjectId: lesson?.subjectId ?? defaultSubjectId ?? subjects[0]?.id ?? "",
    level: lesson?.level ?? defaultLevel ?? 1,
    title: lesson?.title ?? "",
    summary: lesson?.summary ?? "",
    content: lesson?.content ?? "## Explanation\n\n\n## Example\n\n\n## Key points\n\n- ",
    minutes: numberToInput(lesson?.estimatedMinutes),
    topicName: lesson?.topicName ?? "",
  });
  const [form, setForm] = useState(init);
  const save = useSaveMutation(async (input: LessonInput) => {
    if (lesson) await updateLesson(lesson.id, input);
    else await createLesson(input);
  }, onClose);
  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(init());
  }, [open, lesson]);
  const e = save.fieldErrors;
  return (
    <FormModal
      open={open}
      onClose={onClose}
      width="lg"
      title={lesson ? "Edit lesson" : "New lesson"}
      submitLabel={lesson ? "Save" : "Add lesson"}
      submitting={save.isPending}
      formError={save.formError}
      onSubmit={() =>
        save.mutate({ subjectId: form.subjectId, level: form.level, title: form.title, summary: form.summary, content: form.content, estimatedMinutes: parseOptionalNumber(form.minutes), topicName: form.topicName })
      }
    >
      <TextField label="Title" required autoFocus value={form.title} onChange={(ev) => setForm({ ...form, title: ev.target.value })} error={e.title} />
      <div className="grid grid-cols-4 gap-3">
        <SelectField className="col-span-2" label="Subject" value={form.subjectId} onChange={(ev) => setForm({ ...form, subjectId: ev.target.value })} options={subjects.map((s) => ({ value: s.id, label: s.name }))} error={e.subjectId} />
        <SelectField label="Level" value={String(form.level)} onChange={(ev) => setForm({ ...form, level: Number(ev.target.value) })} options={[1, 2, 3, 4].map((l) => ({ value: String(l), label: `${l} — ${LEVEL_LABELS[l]}` }))} />
        <TextField label="Minutes" inputMode="numeric" value={form.minutes} onChange={(ev) => setForm({ ...form, minutes: ev.target.value })} error={e.estimatedMinutes} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Summary" value={form.summary} onChange={(ev) => setForm({ ...form, summary: ev.target.value })} />
        <TextField label="Topic (for mastery)" value={form.topicName} onChange={(ev) => setForm({ ...form, topicName: ev.target.value })} />
      </div>
      <MarkdownField label="Lesson content" value={form.content} onChange={(content) => setForm({ ...form, content })} rows={14} hint="Explanation and examples. Exercises are questions linked to this lesson." />
    </FormModal>
  );
}
