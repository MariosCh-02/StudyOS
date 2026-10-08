import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, FileUp, Plus, Search, Star } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { TextAreaField } from "@/components/ui/Field";
import { usePapers } from "@/hooks/queries";
import { isTauri, pickBibFile, pickSavePath, readTextFile, writeTextFile } from "@/lib/native";
import { formatApa, parseAuthor } from "@/domain/research";
import { addPaperToProject, importBibtex, PAPER_STATUS_LABELS, papersToBibtex, type ImportResult, type Paper, type PaperStatus } from "@/services/papers";

export const PAPER_STATUS_TONE: Record<PaperStatus, "neutral" | "accent" | "success"> = { to_read: "neutral", reading: "accent", read: "success" };

/** "Vaswani et al. · 2017 · NeurIPS" */
export function paperByline(p: Paper): string {
  const fam = p.authors.map((a) => parseAuthor(a).family);
  const who = fam.length === 0 ? null : fam.length === 1 ? fam[0] : fam.length === 2 ? `${fam[0]} & ${fam[1]}` : `${fam[0]} et al.`;
  return [who, p.year, p.venue].filter(Boolean).join(" · ");
}

export function Stars({ value }: { value: number | null }) {
  if (!value) return null;
  return (
    <span className="flex items-center text-warning" aria-label={`Rated ${value} out of 5`}>
      {Array.from({ length: value }, (_, i) => (
        <Star key={i} className="size-3 fill-current" aria-hidden />
      ))}
    </span>
  );
}

export function PaperRow({ paper, action }: { paper: Paper; action?: React.ReactNode }) {
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5">
      <Link to={`/papers/${paper.id}`} className="min-w-0 flex-1">
        <span className="block truncate text-sm hover:text-accent">{paper.title}</span>
        <span className="flex items-center gap-2 text-xs text-muted">
          <span className="truncate">{paperByline(paper) || "No authors yet"}</span>
          <Stars value={paper.rating} />
        </span>
      </Link>
      <Badge tone={PAPER_STATUS_TONE[paper.status]}>{PAPER_STATUS_LABELS[paper.status]}</Badge>
      {action}
    </li>
  );
}

/** APA reference list, alphabetical by first author. */
export function referenceList(papers: Paper[]): { markdown: string; plain: string } {
  const sorted = [...papers].sort((a, b) => (parseAuthor(a.authors[0] ?? a.title).family || a.title).localeCompare(parseAuthor(b.authors[0] ?? b.title).family || b.title));
  const refs = sorted.map(formatApa);
  return { markdown: refs.map((r) => r.markdown).join("\n\n"), plain: refs.map((r) => r.plain).join("\n\n") };
}

/** Saves papers as a .bib file through the native save dialog (or a download in the browser). */
export async function exportBib(papers: Paper[], fileName: string): Promise<boolean> {
  const text = papersToBibtex(papers);
  if (!isTauri()) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/x-bibtex" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  }
  const path = await pickSavePath(fileName, "bib", "BibTeX");
  if (!path) return false;
  await writeTextFile(path, text);
  return true;
}

/** Paste or open a .bib file and import it (optionally into a project). */
export function BibtexImportDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId?: string }) {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setText("");
      setResult(null);
      setError(null);
    }
  }, [open]);

  const openFile = async () => {
    setError(null);
    try {
      const path = await pickBibFile();
      if (path) setText(await readTextFile(path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await importBibtex(text, projectId));
      await client.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      title="Import BibTeX"
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void run()}>
              Import
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <strong>{result.created.length}</strong> {result.created.length === 1 ? "paper" : "papers"} added
            {result.duplicates.length > 0 && <>, {result.duplicates.length} already in your library{projectId ? " (added to this project)" : ""}</>}.
          </p>
          {result.errors.length > 0 && (
            <ul className="list-disc rounded-md bg-danger-soft py-2 pr-3 pl-7 text-danger">
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {isTauri() && (
            <Button className="w-fit" icon={<FileUp className="size-4" />} onClick={() => void openFile()}>
              Open .bib file…
            </Button>
          )}
          <TextAreaField
            label="BibTeX"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"@article{lecun2015deep,\n  title = {Deep learning},\n  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},\n  journal = {Nature},\n  year = {2015}\n}"}
            hint="Export from Zotero, Mendeley or Google Scholar and paste here. Papers already in your library are not duplicated."
            className="[&_textarea]:font-mono [&_textarea]:text-xs"
          />
          {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

/** Pick papers from the library to add to a project. */
export function AddFromLibraryDialog({ open, onClose, projectId, existing }: { open: boolean; onClose: () => void; projectId: string; existing: Set<string> }) {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const papers = usePapers({ search: query });
  useEffect(() => {
    if (open) {
      setQuery("");
      setAdded(new Set());
    }
  }, [open]);
  const add = async (id: string) => {
    await addPaperToProject(projectId, id);
    setAdded((s) => new Set(s).add(id));
    await client.invalidateQueries();
  };
  const list = (papers.data ?? []).filter((p) => !existing.has(p.id) || added.has(p.id));
  return (
    <Modal open={open} onClose={onClose} title="Add papers from your library" width="lg">
      <label className="relative mb-3 block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <span className="sr-only">Search papers</span>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title, author, venue, year…" className="h-10 w-full rounded-md border border-border bg-surface pr-3 pl-9 text-sm focus:border-accent focus:outline-none" />
      </label>
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-subtle">{(papers.data ?? []).length ? "Every matching paper is already in this project." : "No papers found. Add papers in the Papers library first."}</p>
      ) : (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto">
          {list.map((p) => (
            <PaperRow
              key={p.id}
              paper={p}
              action={
                <button
                  type="button"
                  disabled={added.has(p.id)}
                  onClick={() => void add(p.id)}
                  className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs hover:border-accent disabled:border-success disabled:text-success"
                >
                  {added.has(p.id) ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                  {added.has(p.id) ? "Added" : "Add"}
                </button>
              }
            />
          ))}
        </ul>
      )}
    </Modal>
  );
}
