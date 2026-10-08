import { useEffect, useState } from "react";
import { FormModal } from "@/components/ui/Modal";
import { SelectField, TextField } from "@/components/ui/Field";
import { MarkdownField } from "@/components/Markdown";
import { useAllCourses, useSaveMutation } from "@/hooks/queries";
import { createFlashcard, updateFlashcard, type Flashcard, type FlashcardInput } from "@/services/practice";

interface Props {
  open: boolean;
  onClose: () => void;
  card?: Flashcard;
  defaults?: Partial<FlashcardInput>;
  /** Keep the dialog open after saving to add another card quickly. */
  keepOpen?: boolean;
}

export function FlashcardForm({ open, onClose, card, defaults, keepOpen = !card }: Props) {
  const courses = useAllCourses();
  const init = (): FlashcardInput & { tagText: string } => ({
    front: card?.front ?? defaults?.front ?? "",
    back: card?.back ?? defaults?.back ?? "",
    courseId: card?.courseId ?? defaults?.courseId ?? null,
    lessonId: card?.lessonId ?? defaults?.lessonId ?? null,
    noteId: card?.noteId ?? defaults?.noteId ?? null,
    subjectId: card?.subjectId ?? defaults?.subjectId ?? null,
    tags: card?.tags ?? defaults?.tags ?? [],
    topicName: card?.topicName ?? defaults?.topicName ?? "",
    tagText: (card?.tags ?? defaults?.tags ?? []).join(", "),
  });
  const [form, setForm] = useState(init);
  const [added, setAdded] = useState(0);
  const save = useSaveMutation(
    async (input: FlashcardInput) => {
      if (card) await updateFlashcard(card.id, input);
      else await createFlashcard(input);
    },
    () => {
      if (keepOpen) {
        setAdded((n) => n + 1);
        setForm((f) => ({ ...f, front: "", back: "" }));
      } else onClose();
    },
  );

  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(init());
    setAdded(0);
  }, [open, card, defaults]);

  const e = save.fieldErrors;
  const submit = () =>
    save.mutate({
      front: form.front,
      back: form.back,
      courseId: form.courseId,
      lessonId: form.lessonId,
      noteId: form.noteId,
      subjectId: form.subjectId,
      topicName: form.topicName,
      tags: form.tagText.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean),
    });

  return (
    <FormModal open={open} onClose={onClose} title={card ? "Edit flashcard" : "New flashcard"} submitLabel={card ? "Save" : "Add card"} submitting={save.isPending} formError={save.formError} onSubmit={submit}>
      <MarkdownField label="Front (question)" required value={form.front} onChange={(front) => setForm({ ...form, front })} rows={3} error={e.front} />
      <MarkdownField label="Back (answer)" required value={form.back} onChange={(back) => setForm({ ...form, back })} rows={3} error={e.back} />
      <div className="grid grid-cols-3 gap-3">
        <SelectField
          label="Course"
          value={form.courseId ?? ""}
          onChange={(ev) => setForm({ ...form, courseId: ev.target.value || null })}
          options={[{ value: "", label: "None" }, ...(courses.data ?? []).map((c) => ({ value: c.id, label: c.code ?? c.name }))]}
        />
        <TextField label="Topic" value={form.topicName ?? ""} onChange={(ev) => setForm({ ...form, topicName: ev.target.value })} placeholder="e.g. Bayes" />
        <TextField label="Tags" value={form.tagText} onChange={(ev) => setForm({ ...form, tagText: ev.target.value })} placeholder="exam, formula" />
      </div>
      {added > 0 && <p className="text-xs text-success">{added} card{added === 1 ? "" : "s"} added. Keep going, or close when you're done.</p>}
    </FormModal>
  );
}
