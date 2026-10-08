import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { FormModal } from "@/components/ui/Modal";
import { IconButton } from "@/components/ui/Button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { MarkdownField } from "@/components/Markdown";
import { useAllCourses, useSaveMutation } from "@/hooks/queries";
import { createProject, PROJECT_KINDS, PROJECT_LABELS, PROJECT_STATUSES, RESEARCH_KINDS, updateProject, type Project, type ProjectInput, type ProjectLink, type ProjectMember } from "@/services/projects";

interface Props {
  open: boolean;
  onClose: () => void;
  project?: Project;
  /** Must be memoised by the caller: the form resets when it changes. */
  defaults?: Partial<ProjectInput>;
  onSaved?: (p: Project) => void;
}

const toState = (p?: Project, d?: Partial<ProjectInput>): ProjectInput => ({
  title: p?.title ?? d?.title ?? "",
  kind: p?.kind ?? d?.kind ?? "programming",
  status: p?.status ?? d?.status ?? "active",
  description: p?.description ?? d?.description ?? "",
  researchQuestion: p?.researchQuestion ?? d?.researchQuestion ?? "",
  courseId: p?.courseId ?? d?.courseId ?? "",
  startDate: p?.startDate ?? d?.startDate ?? "",
  dueDate: p?.dueDate ?? d?.dueDate ?? "",
  members: p?.members ?? d?.members ?? [],
  links: p?.links ?? d?.links ?? [],
});

const rowInput = "h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm placeholder:text-subtle focus:border-accent focus:outline-none";

function MembersEditor({ value, onChange, error }: { value: ProjectMember[]; onChange: (v: ProjectMember[]) => void; error?: string }) {
  const set = (i: number, patch: Partial<ProjectMember>) => onChange(value.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[13px] font-medium text-muted">Team and supervisors</legend>
      {value.map((m, i) => (
        <div key={i} className="flex items-center gap-2">
          <input aria-label="Name" placeholder="Name" value={m.name} onChange={(e) => set(i, { name: e.target.value })} className={rowInput} />
          <input aria-label="Role" placeholder="Role (e.g. Supervisor)" value={m.role} onChange={(e) => set(i, { role: e.target.value })} className={rowInput} />
          <input aria-label="Email" placeholder="Email (optional)" type="email" value={m.email} onChange={(e) => set(i, { email: e.target.value })} className={rowInput} />
          <IconButton label="Remove person" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X className="size-3.5" />
          </IconButton>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, { name: "", role: "", email: "" }])} className="flex w-fit items-center gap-1 text-xs text-accent hover:underline">
        <Plus className="size-3.5" /> Add person
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </fieldset>
  );
}

function LinksEditor({ value, onChange, error }: { value: ProjectLink[]; onChange: (v: ProjectLink[]) => void; error?: string }) {
  const set = (i: number, patch: Partial<ProjectLink>) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[13px] font-medium text-muted">Links (repository, dataset, Overleaf…)</legend>
      {value.map((l, i) => (
        <div key={i} className="flex items-center gap-2">
          <input aria-label="Label" placeholder="Label" value={l.label} onChange={(e) => set(i, { label: e.target.value })} className={`${rowInput} max-w-40`} />
          <input aria-label="Address" placeholder="https://" value={l.url} onChange={(e) => set(i, { url: e.target.value })} className={rowInput} />
          <IconButton label="Remove link" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X className="size-3.5" />
          </IconButton>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, { label: "", url: "" }])} className="flex w-fit items-center gap-1 text-xs text-accent hover:underline">
        <Plus className="size-3.5" /> Add link
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </fieldset>
  );
}

export function ProjectForm({ open, onClose, project, defaults, onSaved }: Props) {
  const courses = useAllCourses();
  const [form, setForm] = useState<ProjectInput>(() => toState(project, defaults));
  const save = useSaveMutation(
    (input: ProjectInput) => (project ? updateProject(project.id, input) : createProject(input)),
    (p) => {
      onClose();
      onSaved?.(p);
    },
  );

  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(toState(project, defaults));
  }, [open, project, defaults]);

  const set = <K extends keyof ProjectInput>(k: K, v: ProjectInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const e = save.fieldErrors;
  const research = RESEARCH_KINDS.includes(form.kind);

  return (
    <FormModal
      open={open}
      onClose={onClose}
      width="lg"
      title={project ? "Edit project" : "New project"}
      submitLabel={project ? "Save" : "Create project"}
      submitting={save.isPending}
      formError={save.formError}
      onSubmit={() => save.mutate(form)}
    >
      <TextField label="Title" required autoFocus value={form.title} onChange={(ev) => set("title", ev.target.value)} error={e.title} />
      <div className="grid grid-cols-3 gap-3">
        <SelectField label="Type" value={form.kind} onChange={(ev) => set("kind", ev.target.value as ProjectInput["kind"])} options={PROJECT_KINDS.map((k) => ({ value: k, label: PROJECT_LABELS.kind[k] }))} error={e.kind} />
        <SelectField label="Status" value={form.status} onChange={(ev) => set("status", ev.target.value as ProjectInput["status"])} options={PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_LABELS.status[s] }))} error={e.status} />
        <SelectField
          label="Course"
          value={form.courseId ?? ""}
          onChange={(ev) => set("courseId", ev.target.value)}
          options={[{ value: "", label: "None" }, ...(courses.data ?? []).map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))]}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Start date" type="date" value={form.startDate ?? ""} onChange={(ev) => set("startDate", ev.target.value)} error={e.startDate} />
        <TextField label="Due date" type="date" value={form.dueDate ?? ""} onChange={(ev) => set("dueDate", ev.target.value)} error={e.dueDate} hint="Shown on the calendar." />
      </div>
      {research && (
        <TextAreaField
          label="Research question"
          rows={2}
          value={form.researchQuestion ?? ""}
          onChange={(ev) => set("researchQuestion", ev.target.value)}
          placeholder="e.g. Does data augmentation reduce overfitting on small medical image datasets?"
        />
      )}
      <MarkdownField label="Description" value={form.description ?? ""} onChange={(v) => set("description", v)} rows={4} placeholder="Goal, scope, deliverables…" />
      <MembersEditor value={form.members} onChange={(v) => set("members", v)} error={e.members} />
      <LinksEditor value={form.links} onChange={(v) => set("links", v)} error={e.links} />
    </FormModal>
  );
}
