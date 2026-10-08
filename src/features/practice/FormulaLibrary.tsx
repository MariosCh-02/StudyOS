import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Pencil, Plus, Search, Sigma, Trash2, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, EmptyState, Spinner } from "@/components/ui/Feedback";
import { ConfirmDialog, FormModal } from "@/components/ui/Modal";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Latex, Markdown, MarkdownField } from "@/components/Markdown";
import { useAllCourses, useFormulas, useSaveMutation } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { createFormula, deleteFormula, updateFormula, type Formula, type FormulaInput } from "@/services/learning";

export function FormulaForm({ open, onClose, formula, defaultCourseId }: { open: boolean; onClose: () => void; formula?: Formula; defaultCourseId?: string }) {
  const courses = useAllCourses();
  const init = () => ({
    title: formula?.title ?? "",
    latex: formula?.latex ?? "",
    explanation: formula?.explanation ?? "",
    variables: formula?.variables.length ? formula.variables : [{ symbol: "", meaning: "" }],
    example: formula?.example ?? "",
    subject: formula?.subject ?? "",
    topicName: formula?.topicName ?? "",
    courseIds: formula?.courseIds ?? (defaultCourseId ? [defaultCourseId] : []),
    tags: (formula?.tags ?? []).join(", "),
  });
  const [form, setForm] = useState(init);
  const save = useSaveMutation(async (f: ReturnType<typeof init>) => {
    const input: FormulaInput = {
      title: f.title,
      latex: f.latex,
      explanation: f.explanation,
      variables: f.variables,
      example: f.example,
      subject: f.subject,
      courseIds: f.courseIds,
      noteIds: formula?.noteIds ?? [],
      tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    if (formula) await updateFormula(formula.id, input, f.topicName);
    else await createFormula(input, f.topicName);
  }, onClose);
  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(init());
  }, [open, formula]);
  const e = save.fieldErrors;

  return (
    <FormModal open={open} onClose={onClose} width="lg" title={formula ? "Edit formula" : "New formula"} submitLabel={formula ? "Save" : "Add formula"} submitting={save.isPending} formError={save.formError} onSubmit={() => save.mutate(form)}>
      <TextField label="Name" required autoFocus value={form.title} onChange={(ev) => setForm({ ...form, title: ev.target.value })} error={e.title} placeholder="e.g. Gradient descent update" />
      <TextAreaField label="Formula (LaTeX)" required className="font-mono" rows={2} value={form.latex} onChange={(ev) => setForm({ ...form, latex: ev.target.value })} error={e.latex} placeholder="\theta_{new} = \theta - \alpha \nabla J(\theta)" />
      {form.latex.trim() && (
        <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2">
          <Latex latex={form.latex} />
        </div>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium text-muted">Variables</legend>
        {form.variables.map((v, i) => (
          <div key={i} className="grid grid-cols-[8rem_1fr_auto] gap-2">
            <input aria-label={`Symbol ${i + 1}`} value={v.symbol} placeholder="\alpha" onChange={(ev) => setForm({ ...form, variables: form.variables.map((x, j) => (j === i ? { ...x, symbol: ev.target.value } : x)) })} className="h-9 rounded-md border border-border bg-surface px-3 font-mono text-sm focus:border-accent focus:outline-none" />
            <input aria-label={`Meaning ${i + 1}`} value={v.meaning} placeholder="learning rate" onChange={(ev) => setForm({ ...form, variables: form.variables.map((x, j) => (j === i ? { ...x, meaning: ev.target.value } : x)) })} className="h-9 rounded-md border border-border bg-surface px-3 text-sm focus:border-accent focus:outline-none" />
            <IconButton label="Remove variable" onClick={() => setForm({ ...form, variables: form.variables.filter((_, j) => j !== i) })}>
              <X className="size-4" />
            </IconButton>
          </div>
        ))}
        <Button size="sm" variant="ghost" className="self-start" icon={<Plus className="size-3.5" />} onClick={() => setForm({ ...form, variables: [...form.variables, { symbol: "", meaning: "" }] })}>
          Add variable
        </Button>
      </fieldset>
      <MarkdownField label="Explanation" value={form.explanation} onChange={(explanation) => setForm({ ...form, explanation })} rows={3} />
      <MarkdownField label="Example" value={form.example} onChange={(example) => setForm({ ...form, example })} rows={3} />
      <div className="grid grid-cols-3 gap-3">
        <TextField label="Subject" value={form.subject} onChange={(ev) => setForm({ ...form, subject: ev.target.value })} placeholder="Physics, Statistics…" />
        <TextField label="Topic" value={form.topicName} onChange={(ev) => setForm({ ...form, topicName: ev.target.value })} />
        <TextField label="Tags" value={form.tags} onChange={(ev) => setForm({ ...form, tags: ev.target.value })} placeholder="exam" />
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-muted">Related courses</legend>
        <div className="flex flex-wrap gap-2">
          {(courses.data ?? []).map((c) => {
            const on = form.courseIds.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => setForm({ ...form, courseIds: on ? form.courseIds.filter((x) => x !== c.id) : [...form.courseIds, c.id] })}
                className={on ? "rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent" : "rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:text-fg"}
              >
                {c.code ?? c.name}
              </button>
            );
          })}
        </div>
      </fieldset>
    </FormModal>
  );
}

export function FormulaCard({ formula: f, onEdit, onDelete, compact }: { formula: Formula; onEdit?: () => void; onDelete?: () => void; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(f.latex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable; ignore.
    }
  };
  return (
    <div className="group rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{f.title}</p>
          <p className="text-xs text-subtle">{[f.subject, f.topicName].filter(Boolean).join(" · ")}</p>
        </div>
        <IconButton label={copied ? "Copied" : "Copy LaTeX"} onClick={() => void copy()}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </IconButton>
        {onEdit && (
          <IconButton label="Edit formula" onClick={onEdit} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
            <Pencil className="size-3.5" />
          </IconButton>
        )}
        {onDelete && (
          <IconButton label="Delete formula" onClick={onDelete} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
            <Trash2 className="size-3.5" />
          </IconButton>
        )}
      </div>
      <Latex latex={f.latex} className="py-1" />
      {!compact && f.variables.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {f.variables.map((v) => (
            <div key={v.symbol} className="contents">
              <dt>
                <Latex latex={v.symbol} display={false} />
              </dt>
              <dd className="text-muted">{v.meaning}</dd>
            </div>
          ))}
        </dl>
      )}
      {!compact && f.explanation && <Markdown source={f.explanation} className="mt-2 text-sm text-muted" />}
      {!compact && f.example && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-accent">Example</summary>
          <Markdown source={f.example} className="mt-1" />
        </details>
      )}
    </div>
  );
}

/** Searchable formula library; `courseId` narrows it to a course's formula sheet. */
export function FormulaLibrary({ courseId, compact }: { courseId?: string; compact?: boolean }) {
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const all = useFormulas({ courseId });
  const formulas = useFormulas({ courseId, search: search || undefined, subject: subject || undefined });
  const [editing, setEditing] = useState<Formula | null>(null);
  const [creating, setCreating] = useState(false);
  const remove = useConfirmAction((f: Formula) => deleteFormula(f.id));
  const subjects = useMemo(() => [...new Set((all.data ?? []).map((f) => f.subject).filter((s): s is string => !!s))].sort(), [all.data]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search formulas</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search formulas…" className="h-9 w-full rounded-md border border-border bg-surface pr-3 pl-9 text-sm focus:border-accent focus:outline-none" />
        </label>
        {!compact && subjects.length > 0 && (
          <select aria-label="Filter by subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm focus:border-accent focus:outline-none">
            <option value="">All subjects</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          {compact ? "" : "New formula"}
        </Button>
      </div>
      {formulas.isPending ? (
        <Spinner />
      ) : (formulas.data ?? []).length === 0 ? (
        <Card>
          <EmptyState compact={compact} icon={<Sigma className="size-5" />} title={search ? "No matching formulas" : "No formulas yet"} description={courseId ? "Link formulas to this course to build its formula sheet." : "Add formulas for any subject: physics, statistics, chemistry, AI…"} />
        </Card>
      ) : (
        <div className={compact ? "flex flex-col gap-3" : "grid grid-cols-2 gap-4"}>
          {(formulas.data ?? []).map((f) => (
            <FormulaCard key={f.id} formula={f} compact={compact} onEdit={() => setEditing(f)} onDelete={() => remove.ask(f)} />
          ))}
        </div>
      )}
      <FormulaForm open={creating} onClose={() => setCreating(false)} defaultCourseId={courseId} />
      <FormulaForm open={editing != null} formula={editing ?? undefined} onClose={() => setEditing(null)} />
      <ConfirmDialog open={remove.target != null} title="Delete formula?" busy={remove.busy} error={remove.error} onClose={remove.cancel} onConfirm={remove.confirm} message={<p>“{remove.target?.title}” will be removed.</p>} />
    </div>
  );
}
