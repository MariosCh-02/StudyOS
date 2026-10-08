import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { FormModal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { numberToInput, parseOptionalNumber, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { useSaveMutation } from "@/hooks/queries";
import { parseAuthorList } from "@/domain/research";
import { createPaper, ENTRY_TYPE_LABELS, ENTRY_TYPES, lookupDoi, PAPER_STATUS_LABELS, PAPER_STATUSES, updatePaper, type Paper, type PaperInput, type PaperStatus } from "@/services/papers";

interface Props {
  open: boolean;
  onClose: () => void;
  paper?: Paper;
  onSaved?: (p: Paper) => void;
}

interface FormState {
  title: string;
  authors: string;
  year: string;
  venue: string;
  doi: string;
  url: string;
  abstract: string;
  entryType: string;
  citeKey: string;
  status: PaperStatus;
  rating: string;
}

const toState = (p?: Paper): FormState => ({
  title: p?.title ?? "",
  authors: (p?.authors ?? []).join("\n"),
  year: numberToInput(p?.year),
  venue: p?.venue ?? "",
  doi: p?.doi ?? "",
  url: p?.url ?? "",
  abstract: p?.abstract ?? "",
  entryType: p?.entryType ?? "article",
  citeKey: p?.citeKey ?? "",
  status: p?.status ?? "to_read",
  rating: numberToInput(p?.rating),
});

export function PaperForm({ open, onClose, paper, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => toState(paper));
  const [lookup, setLookup] = useState<{ busy: boolean; message: string | null; error: boolean }>({ busy: false, message: null, error: false });
  const save = useSaveMutation(
    (input: PaperInput) => (paper ? updatePaper(paper.id, input) : createPaper(input)),
    (p) => {
      onClose();
      onSaved?.(p);
    },
  );

  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(toState(paper));
    setLookup({ busy: false, message: null, error: false });
  }, [open, paper]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const e = save.fieldErrors;

  const runLookup = async () => {
    setLookup({ busy: true, message: null, error: false });
    try {
      const f = await lookupDoi(form.doi);
      setForm((s) => ({
        ...s,
        title: f.title,
        authors: f.authors.join("\n"),
        year: numberToInput(f.year),
        venue: f.venue ?? "",
        doi: f.doi ?? s.doi,
        url: f.url ?? s.url,
        abstract: f.abstract ?? s.abstract,
        entryType: f.entryType,
      }));
      setLookup({ busy: false, message: "Details filled in from Crossref. Check them before saving.", error: false });
    } catch (err) {
      setLookup({ busy: false, message: err instanceof Error ? err.message : String(err), error: true });
    }
  };

  const year = parseOptionalNumber(form.year);
  const rating = parseOptionalNumber(form.rating);

  return (
    <FormModal
      open={open}
      onClose={onClose}
      width="lg"
      title={paper ? "Edit paper" : "Add paper"}
      submitLabel={paper ? "Save" : "Add paper"}
      submitting={save.isPending}
      formError={save.formError}
      onSubmit={() =>
        save.mutate({
          title: form.title,
          authors: parseAuthorList(form.authors),
          year,
          venue: form.venue,
          doi: form.doi,
          url: form.url,
          abstract: form.abstract,
          entryType: form.entryType,
          citeKey: form.citeKey,
          summary: paper?.summary ?? null,
          status: form.status,
          rating,
        })
      }
    >
      <div className="flex items-end gap-2">
        <TextField
          label="DOI"
          className="flex-1"
          placeholder="10.1038/nature14539 or https://doi.org/…"
          value={form.doi}
          onChange={(ev) => set("doi", ev.target.value)}
          error={e.doi}
        />
        <Button className={e.doi ? "mb-5" : undefined} icon={<Search className="size-4" />} loading={lookup.busy} disabled={!form.doi.trim()} onClick={() => void runLookup()}>
          Look up
        </Button>
      </div>
      <p className="-mt-2 text-xs text-subtle">Look up fills in the details from Crossref; only the DOI is sent.</p>
      {lookup.message && <p className={lookup.error ? "rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" : "rounded-md bg-success-soft px-3 py-2 text-sm text-success"}>{lookup.message}</p>}
      <TextField label="Title" required autoFocus={!paper} value={form.title} onChange={(ev) => set("title", ev.target.value)} error={e.title} />
      <TextAreaField label="Authors" rows={3} value={form.authors} onChange={(ev) => set("authors", ev.target.value)} hint="One per line, as “Family, Given” or “Given Family”." />
      <div className="grid grid-cols-[6rem_1fr_1fr] gap-3">
        <TextField label="Year" inputMode="numeric" value={form.year} onChange={(ev) => set("year", ev.target.value)} error={e.year} />
        <SelectField label="Type" value={form.entryType} onChange={(ev) => set("entryType", ev.target.value)} options={ENTRY_TYPES.map((t) => ({ value: t, label: ENTRY_TYPE_LABELS[t] ?? t }))} />
        <TextField label="Journal / conference" value={form.venue} onChange={(ev) => set("venue", ev.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Link" placeholder="https://arxiv.org/abs/…" value={form.url} onChange={(ev) => set("url", ev.target.value)} error={e.url} />
        <TextField label="Citation key" placeholder="Generated if empty" value={form.citeKey} onChange={(ev) => set("citeKey", ev.target.value)} error={e.citeKey} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Reading status" value={form.status} onChange={(ev) => set("status", ev.target.value as PaperStatus)} options={PAPER_STATUSES.map((s) => ({ value: s, label: PAPER_STATUS_LABELS[s] }))} />
        <SelectField
          label="Rating"
          value={form.rating}
          onChange={(ev) => set("rating", ev.target.value)}
          error={e.rating}
          options={[{ value: "", label: "Not rated" }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: "★".repeat(n) }))]}
        />
      </div>
      <TextAreaField label="Abstract" rows={4} value={form.abstract} onChange={(ev) => set("abstract", ev.target.value)} />
    </FormModal>
  );
}
