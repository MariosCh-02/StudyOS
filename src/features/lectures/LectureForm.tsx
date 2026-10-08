import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { FormModal } from "@/components/ui/Modal";
import { Button, IconButton } from "@/components/ui/Button";
import { numberToInput, parseOptionalNumber, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { useSaveMutation } from "@/hooks/queries";
import { REVISION_LABELS, REVISION_STATUSES, type Course, type Lecture, type LectureInput, type LectureLink } from "@/domain/types";
import { toDateKey } from "@/domain/dates";
import { createLecture, nextLectureNumber, updateLecture } from "@/services/lectures";

interface Props {
  open: boolean;
  onClose: () => void;
  course: Course;
  lecture?: Lecture;
  onSaved?: (l: Lecture) => void;
}

interface FormState {
  number: string;
  title: string;
  date: string;
  startTime: string;
  lecturer: string;
  comments: string;
  revisionStatus: LectureInput["revisionStatus"];
  links: LectureLink[];
}

export function LectureForm({ open, onClose, course, lecture, onSaved }: Props) {
  const [form, setForm] = useState<FormState | null>(null);
  const save = useSaveMutation(
    (input: LectureInput) => (lecture ? updateLecture(lecture.id, input) : createLecture(input)),
    (saved) => {
      onSaved?.(saved);
      onClose();
    },
  );

  useEffect(() => {
    if (!open) return;
    save.reset();
    let alive = true;
    void (async () => {
      const number = lecture ? lecture.number : await nextLectureNumber(course.id);
      if (!alive) return;
      setForm({
        number: numberToInput(number),
        title: lecture?.title ?? "",
        date: lecture?.date ?? toDateKey(new Date()),
        startTime: lecture?.startTime ?? "",
        lecturer: lecture?.lecturer ?? course.lecturer ?? "",
        comments: lecture?.comments ?? "",
        revisionStatus: lecture?.revisionStatus ?? "not_reviewed",
        links: lecture?.links ?? [],
      });
    })();
    return () => {
      alive = false;
    };
  }, [open, lecture, course]);

  if (!form) return null;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setLink = (i: number, patch: Partial<LectureLink>) => set("links", form.links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const e = save.fieldErrors;

  const submit = () =>
    save.mutate({
      courseId: course.id,
      number: parseOptionalNumber(form.number),
      title: form.title,
      date: form.date || null,
      startTime: form.startTime || null,
      lecturer: form.lecturer,
      comments: form.comments,
      revisionStatus: form.revisionStatus,
      links: form.links.filter((l) => l.url.trim()),
    });

  return (
    <FormModal
      open={open}
      onClose={onClose}
      width="lg"
      title={lecture ? "Edit lecture" : `New lecture · ${course.name}`}
      submitLabel={lecture ? "Save" : "Create lecture"}
      submitting={save.isPending}
      formError={save.formError}
      onSubmit={submit}
    >
      <div className="grid grid-cols-[6rem_1fr] gap-3">
        <TextField label="Number" inputMode="numeric" value={form.number} onChange={(ev) => set("number", ev.target.value)} error={e.number} />
        <TextField label="Topic" required autoFocus placeholder="e.g. Gradient Descent" value={form.title} onChange={(ev) => set("title", ev.target.value)} error={e.title} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <TextField label="Date" type="date" value={form.date} onChange={(ev) => set("date", ev.target.value)} error={e.date} />
        <TextField label="Start time" type="time" value={form.startTime} onChange={(ev) => set("startTime", ev.target.value)} error={e.startTime} />
        <SelectField
          label="Revision"
          value={form.revisionStatus}
          onChange={(ev) => set("revisionStatus", ev.target.value as FormState["revisionStatus"])}
          options={REVISION_STATUSES.map((s) => ({ value: s, label: REVISION_LABELS[s] }))}
        />
      </div>
      <TextField label="Lecturer" value={form.lecturer} onChange={(ev) => set("lecturer", ev.target.value)} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13px] font-medium text-muted">Links</legend>
        {form.links.map((l, i) => (
          <div key={i} className="grid grid-cols-[10rem_1fr_auto] gap-2">
            <input
              aria-label="Link label"
              placeholder="Label"
              value={l.label}
              onChange={(ev) => setLink(i, { label: ev.target.value })}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm focus:border-accent focus:outline-none"
            />
            <input
              aria-label="Link address"
              placeholder="https://"
              value={l.url}
              onChange={(ev) => setLink(i, { url: ev.target.value })}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm focus:border-accent focus:outline-none"
            />
            <IconButton label="Remove link" onClick={() => set("links", form.links.filter((_, j) => j !== i))}>
              <X className="size-4" />
            </IconButton>
          </div>
        ))}
        {e.links && <p className="text-xs text-danger">{e.links}</p>}
        <Button size="sm" variant="ghost" className="self-start" icon={<Plus className="size-3.5" />} onClick={() => set("links", [...form.links, { label: "", url: "" }])}>
          Add link
        </Button>
      </fieldset>

      <TextAreaField label="Personal comments" value={form.comments} onChange={(ev) => set("comments", ev.target.value)} />
    </FormModal>
  );
}
