import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Search } from "lucide-react";
import { FormModal, Modal } from "@/components/ui/Modal";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Latex, MarkdownField } from "@/components/Markdown";
import { useSaveMutation, useSearch } from "@/hooks/queries";
import { createEntry, linkEntry, saveConceptFromNote, updateEntry, type KnowledgeEntry, type KnowledgeInput, type LinkTarget } from "@/services/knowledge";
import { SEARCH_TYPE_LABELS } from "@/services/search";
import { Snippet } from "@/features/search/SearchPage";

export function ConceptForm({ open, onClose, entry, onSaved }: { open: boolean; onClose: () => void; entry?: KnowledgeEntry; onSaved?: (e: KnowledgeEntry) => void }) {
  const init = () => ({
    title: entry?.title ?? "",
    aliases: (entry?.aliases ?? []).join(", "),
    definition: entry?.definition ?? "",
    formula: entry?.formula ?? "",
    intuition: entry?.intuition ?? "",
    examples: entry?.examples ?? "",
  });
  const [form, setForm] = useState(init);
  const save = useSaveMutation(
    (f: ReturnType<typeof init>) => {
      const input: KnowledgeInput = { ...f, aliases: f.aliases.split(",").map((a) => a.trim()).filter(Boolean), formula: f.formula, intuition: f.intuition, examples: f.examples };
      return entry ? updateEntry(entry.id, input) : createEntry(input);
    },
    (e) => {
      onSaved?.(e);
      onClose();
    },
  );
  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(init());
  }, [open, entry]);
  return (
    <FormModal open={open} onClose={onClose} width="lg" title={entry ? "Edit concept" : "New concept"} submitLabel={entry ? "Save" : "Create concept"} submitting={save.isPending} formError={save.formError} onSubmit={() => save.mutate(form)}>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Concept" required autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={save.fieldErrors.title} placeholder="e.g. Gradient descent" />
        <TextField label="Also known as" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} placeholder="comma-separated" />
      </div>
      <MarkdownField label="Definition" value={form.definition} onChange={(definition) => setForm({ ...form, definition })} rows={3} />
      <TextAreaField label="Formula (LaTeX, optional)" className="font-mono" rows={2} value={form.formula} onChange={(e) => setForm({ ...form, formula: e.target.value })} />
      {form.formula.trim() && (
        <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2">
          <Latex latex={form.formula} />
        </div>
      )}
      <MarkdownField label="Intuition" value={form.intuition} onChange={(intuition) => setForm({ ...form, intuition })} rows={3} />
      <MarkdownField label="Examples" value={form.examples} onChange={(examples) => setForm({ ...form, examples })} rows={3} />
    </FormModal>
  );
}

const LINKABLE: LinkTarget[] = ["course", "lecture", "note", "lesson", "formula", "flashcard", "question", "paper", "project"];

/** Search across linkable items and attach them to a concept. */
export function LinkDialog({ open, onClose, entryId }: { open: boolean; onClose: () => void; entryId: string }) {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const results = useSearch(open ? query : "", { types: LINKABLE, limit: 20 });
  useEffect(() => {
    if (open) {
      setQuery("");
      setAdded(new Set());
    }
  }, [open]);
  const link = async (type: LinkTarget, id: string) => {
    await linkEntry(entryId, type, id);
    setAdded((s) => new Set(s).add(`${type}:${id}`));
    await client.invalidateQueries({ queryKey: ["linked", entryId] });
    await client.invalidateQueries({ queryKey: ["entriesFor"] });
  };
  return (
    <Modal open={open} onClose={onClose} title="Link to this concept" width="lg">
      <label className="relative mb-3 block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <span className="sr-only">Search items</span>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search courses, lectures, notes, lessons, formulas, flashcards, questions, papers, projects…" className="h-10 w-full rounded-md border border-border bg-surface pr-3 pl-9 text-sm focus:border-accent focus:outline-none" />
      </label>
      <ul className="max-h-96 divide-y divide-border overflow-y-auto">
        {(query.trim() ? (results.data ?? []) : []).map((r) => {
          const key = `${r.type}:${r.id}`;
          return (
            <li key={key} className="flex items-center gap-3 py-2">
              <span className="w-24 shrink-0 text-[11px] text-subtle">{SEARCH_TYPE_LABELS[r.type]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{r.title || "Untitled"}</span>
                <Snippet text={r.snippet} className="line-clamp-1 text-xs text-muted" />
              </span>
              <button
                type="button"
                disabled={added.has(key)}
                onClick={() => void link(r.type as LinkTarget, r.id)}
                className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:border-accent disabled:border-success disabled:text-success"
              >
                {added.has(key) ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                {added.has(key) ? "Linked" : "Link"}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

/** From a note: save the selected term as a concept, linked to the note, lecture and course. */
export function SaveConceptDialog({ open, onClose, initialName, ctx, onSaved }: { open: boolean; onClose: () => void; initialName: string; ctx: { noteId: string; lectureId: string | null; courseId: string | null }; onSaved: (e: KnowledgeEntry) => void }) {
  const [name, setName] = useState(initialName);
  const [definition, setDefinition] = useState("");
  const save = useSaveMutation(() => saveConceptFromNote(name, definition, ctx), (e) => {
    onSaved(e);
    onClose();
  });
  useEffect(() => {
    if (!open) return;
    save.reset();
    // A short selection is a name; a long one is more likely a definition.
    if (initialName.length > 60) {
      setName("");
      setDefinition(initialName);
    } else {
      setName(initialName);
      setDefinition("");
    }
  }, [open, initialName]);
  return (
    <FormModal open={open} onClose={onClose} title="Save concept to knowledge base" submitLabel="Save concept" submitting={save.isPending} formError={save.formError} onSubmit={() => save.mutate(undefined)}>
      <TextField label="Concept" required autoFocus value={name} onChange={(e) => setName(e.target.value)} error={save.fieldErrors.title} placeholder="e.g. Gradient descent" hint="If the concept already exists, this note is linked to it." />
      <MarkdownField label="Definition" value={definition} onChange={setDefinition} rows={3} />
    </FormModal>
  );
}
