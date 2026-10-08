import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { FormModal } from "@/components/ui/Modal";
import { Button, IconButton } from "@/components/ui/Button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { MarkdownField } from "@/components/Markdown";
import { useAllCourses, useSaveMutation, useSubjects } from "@/hooks/queries";
import { emptyData, QUESTION_TYPE_LABELS, QUESTION_TYPES, type Choice, type QuestionData, type QuestionType } from "@/domain/questions";
import { CODE_LANGUAGES } from "@/features/notes/editor/CodeBlockView";
import { newId } from "@/lib/ids";
import { createQuestion, updateQuestion, type Question, type QuestionInput } from "@/services/practice";

const mono = "font-mono text-[13px]";

function ChoicesEditor({ choices, onChange, multiple }: { choices: Choice[]; onChange: (c: Choice[]) => void; multiple: boolean }) {
  const set = (id: string, patch: Partial<Choice>) => onChange(choices.map((c) => (c.id === id ? { ...c, ...patch } : multiple || patch.correct !== true ? c : { ...c, correct: false })));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[13px] font-medium text-muted">Options (tick the correct {multiple ? "ones" : "one"})</legend>
      {choices.map((c, i) => (
        <div key={c.id} className="grid grid-cols-[auto_1fr_1fr_auto] items-start gap-2">
          <input
            type={multiple ? "checkbox" : "radio"}
            name="correct"
            aria-label={`Option ${i + 1} is correct`}
            checked={c.correct}
            onChange={(e) => set(c.id, { correct: e.target.checked })}
            className="mt-2.5 size-4 accent-[var(--accent)]"
          />
          <input aria-label={`Option ${i + 1}`} value={c.text} onChange={(e) => set(c.id, { text: e.target.value })} placeholder={`Option ${i + 1}`} className="h-9 rounded-md border border-border bg-surface px-3 text-sm focus:border-accent focus:outline-none" />
          <input aria-label={`Why option ${i + 1} is wrong`} value={c.why ?? ""} disabled={c.correct} onChange={(e) => set(c.id, { why: e.target.value })} placeholder={c.correct ? "" : "Why it's wrong (optional)"} className="h-9 rounded-md border border-border bg-surface px-3 text-sm focus:border-accent focus:outline-none disabled:opacity-40" />
          <IconButton label={`Remove option ${i + 1}`} disabled={choices.length <= 2} onClick={() => onChange(choices.filter((x) => x.id !== c.id))}>
            <X className="size-4" />
          </IconButton>
        </div>
      ))}
      <Button size="sm" variant="ghost" className="self-start" icon={<Plus className="size-3.5" />} onClick={() => onChange([...choices, { id: newId().slice(0, 8), text: "", correct: false }])}>
        Add option
      </Button>
    </fieldset>
  );
}

function ListEditor({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <TextAreaField label={label} rows={3} value={items.join("\n")} onChange={(e) => onChange(e.target.value.split("\n"))} hint="One per line." placeholder={placeholder} />
  );
}

function DataEditor({ data, onChange }: { data: QuestionData; onChange: (d: QuestionData) => void }) {
  const langOptions = CODE_LANGUAGES.map((l) => ({ value: l.value, label: l.label }));
  switch (data.type) {
    case "mcq":
      return (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!data.multiple} onChange={(e) => onChange({ ...data, multiple: e.target.checked })} className="size-4 accent-[var(--accent)]" />
            Allow more than one correct answer
          </label>
          <ChoicesEditor choices={data.choices} multiple={!!data.multiple} onChange={(choices) => onChange({ ...data, choices })} />
        </>
      );
    case "numeric":
      return (
        <div className="grid grid-cols-3 gap-3">
          <TextField label="Answer" inputMode="decimal" value={Number.isFinite(data.answer) ? String(data.answer) : ""} onChange={(e) => onChange({ ...data, answer: e.target.value.trim() === "" ? Number.NaN : Number(e.target.value) })} />
          <TextField label="± Tolerance" inputMode="decimal" value={String(data.tolerance ?? 0)} onChange={(e) => onChange({ ...data, tolerance: Number(e.target.value) || 0 })} />
          <TextField label="Unit (optional)" value={data.unit ?? ""} onChange={(e) => onChange({ ...data, unit: e.target.value || undefined })} />
        </div>
      );
    case "short":
      return <ListEditor label="Accepted answers" items={data.accepted} onChange={(accepted) => onChange({ ...data, accepted })} placeholder={"overfitting\nover-fitting"} />;
    case "explain":
      return (
        <>
          <MarkdownField label="Model answer" value={data.modelAnswer} onChange={(modelAnswer) => onChange({ ...data, modelAnswer })} rows={4} />
          <ListEditor label="Key points to check" items={data.keyPoints} onChange={(keyPoints) => onChange({ ...data, keyPoints: keyPoints })} placeholder="Mentions the learning rate" />
        </>
      );
    case "predict":
      return (
        <>
          <SelectField label="Language" value={data.language} onChange={(e) => onChange({ ...data, language: e.target.value })} options={langOptions} />
          <TextAreaField label="Code" className={mono} rows={6} value={data.code} onChange={(e) => onChange({ ...data, code: e.target.value })} />
          <TextAreaField label="Expected output" className={mono} rows={3} value={data.output} onChange={(e) => onChange({ ...data, output: e.target.value })} />
        </>
      );
    case "matching":
      return (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium text-muted">Pairs (shown shuffled)</legend>
          {data.pairs.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input aria-label={`Left ${i + 1}`} value={p.left} placeholder="Term" onChange={(e) => onChange({ ...data, pairs: data.pairs.map((x, j) => (j === i ? { ...x, left: e.target.value } : x)) })} className="h-9 rounded-md border border-border bg-surface px-3 text-sm focus:border-accent focus:outline-none" />
              <input aria-label={`Right ${i + 1}`} value={p.right} placeholder="Matches" onChange={(e) => onChange({ ...data, pairs: data.pairs.map((x, j) => (j === i ? { ...x, right: e.target.value } : x)) })} className="h-9 rounded-md border border-border bg-surface px-3 text-sm focus:border-accent focus:outline-none" />
              <IconButton label={`Remove pair ${i + 1}`} disabled={data.pairs.length <= 2} onClick={() => onChange({ ...data, pairs: data.pairs.filter((_, j) => j !== i) })}>
                <X className="size-4" />
              </IconButton>
            </div>
          ))}
          <Button size="sm" variant="ghost" className="self-start" icon={<Plus className="size-3.5" />} onClick={() => onChange({ ...data, pairs: [...data.pairs, { left: "", right: "" }] })}>
            Add pair
          </Button>
        </fieldset>
      );
    case "coding":
      return (
        <>
          <SelectField label="Language" value={data.language} onChange={(e) => onChange({ ...data, language: e.target.value })} options={langOptions} />
          <TextAreaField label="Starter code (optional)" className={mono} rows={4} value={data.starter ?? ""} onChange={(e) => onChange({ ...data, starter: e.target.value })} />
          <TextAreaField label="Reference solution" className={mono} rows={8} value={data.solution} onChange={(e) => onChange({ ...data, solution: e.target.value })} />
          <ListEditor label="What a good solution does" items={data.keyPoints ?? []} onChange={(keyPoints) => onChange({ ...data, keyPoints })} placeholder="Handles the empty list" />
        </>
      );
    case "debugging":
      return (
        <>
          <SelectField label="Language" value={data.language} onChange={(e) => onChange({ ...data, language: e.target.value })} options={langOptions} />
          <TextAreaField label="Buggy code" className={mono} rows={6} value={data.code} onChange={(e) => onChange({ ...data, code: e.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!data.choices}
              onChange={(e) => onChange({ ...data, choices: e.target.checked ? [{ id: "a", text: "", correct: true }, { id: "b", text: "", correct: false }] : undefined })}
              className="size-4 accent-[var(--accent)]"
            />
            Multiple-choice (otherwise the learner describes the fix)
          </label>
          {data.choices ? (
            <ChoicesEditor choices={data.choices} multiple={false} onChange={(choices) => onChange({ ...data, choices })} />
          ) : (
            <MarkdownField label="The bug and the fix" value={data.modelAnswer ?? ""} onChange={(modelAnswer) => onChange({ ...data, modelAnswer })} rows={4} />
          )}
        </>
      );
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  question?: Question;
  defaults?: Partial<Pick<QuestionInput, "lessonId" | "subjectId" | "courseId" | "topicName">>;
}

export function QuestionForm({ open, onClose, question, defaults }: Props) {
  const courses = useAllCourses();
  const subjects = useSubjects();
  const init = (): QuestionInput => ({
    type: question?.type ?? "mcq",
    prompt: question?.prompt ?? "",
    data: question?.data ?? emptyData("mcq"),
    explanation: question?.explanation ?? "",
    whyWrong: question?.whyWrong ?? "",
    example: question?.example ?? "",
    hint: question?.hint ?? "",
    difficulty: question?.difficulty ?? 3,
    lessonId: question?.lessonId ?? defaults?.lessonId ?? null,
    subjectId: question?.subjectId ?? defaults?.subjectId ?? null,
    courseId: question?.courseId ?? defaults?.courseId ?? null,
    tags: question?.tags ?? [],
    topicName: question?.topicName ?? defaults?.topicName ?? "",
  });
  const [form, setForm] = useState<QuestionInput>(init);
  const save = useSaveMutation(async (input: QuestionInput) => {
    if (question) await updateQuestion(question.id, input);
    else await createQuestion(input);
  }, onClose);

  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(init());
  }, [open, question, defaults]);

  const set = <K extends keyof QuestionInput>(k: K, v: QuestionInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const e = save.fieldErrors;

  return (
    <FormModal open={open} onClose={onClose} width="lg" title={question ? "Edit question" : "New question"} submitLabel={question ? "Save" : "Add question"} submitting={save.isPending} formError={save.formError} onSubmit={() => save.mutate(form)}>
      <div className="grid grid-cols-3 gap-3">
        <SelectField
          label="Type"
          value={form.type}
          onChange={(ev) => {
            const type = ev.target.value as QuestionType;
            setForm((f) => ({ ...f, type, data: emptyData(type) }));
          }}
          options={QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_LABELS[t] }))}
        />
        <SelectField label="Difficulty" value={String(form.difficulty)} onChange={(ev) => set("difficulty", Number(ev.target.value))} options={[1, 2, 3, 4, 5].map((d) => ({ value: String(d), label: `${d} — ${["Very easy", "Easy", "Medium", "Hard", "Very hard"][d - 1]}` }))} error={e.difficulty} />
        <TextField label="Topic" value={form.topicName ?? ""} onChange={(ev) => set("topicName", ev.target.value)} placeholder="e.g. Eigenvalues" hint="Used for mastery" />
      </div>
      <MarkdownField label="Question" required value={form.prompt} onChange={(v) => set("prompt", v)} rows={4} error={e.prompt} />
      <DataEditor data={form.data} onChange={(data) => set("data", data)} />
      {e.data && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{e.data}</p>}
      <MarkdownField label="Explanation" value={form.explanation ?? ""} onChange={(v) => set("explanation", v)} rows={3} hint="Shown after answering." />
      <div className="grid grid-cols-2 gap-3">
        <MarkdownField label="Common mistake (why wrong)" value={form.whyWrong ?? ""} onChange={(v) => set("whyWrong", v)} rows={2} hint="Shown for wrong answers." />
        <MarkdownField label="Worked example" value={form.example ?? ""} onChange={(v) => set("example", v)} rows={2} hint="Shown for wrong answers." />
      </div>
      <MarkdownField label="Hint" value={form.hint ?? ""} onChange={(v) => set("hint", v)} rows={2} hint="Available before answering." />
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Subject" value={form.subjectId ?? ""} onChange={(ev) => set("subjectId", ev.target.value || null)} options={[{ value: "", label: "None" }, ...(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
        <SelectField label="Course" value={form.courseId ?? ""} onChange={(ev) => set("courseId", ev.target.value || null)} options={[{ value: "", label: "None" }, ...(courses.data ?? []).map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))]} />
      </div>
      {question?.packId && <p className="text-xs text-warning">This question comes from a content pack. Reinstalling the pack would replace your edits.</p>}
    </FormModal>
  );
}
