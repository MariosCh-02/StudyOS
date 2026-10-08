import { useState } from "react";
import { useNavigate } from "react-router";
import clsx from "clsx";
import { Download, FileText, FileUp, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Card, EmptyState, ErrorState, Spinner } from "@/components/ui/Feedback";
import { usePapers } from "@/hooks/queries";
import { PAPER_STATUS_LABELS, PAPER_STATUSES, type PaperStatus } from "@/services/papers";
import { PaperForm } from "./PaperForm";
import { BibtexImportDialog, exportBib, PaperRow } from "./PaperParts";

export default function PapersPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<PaperStatus | "">("");
  const [query, setQuery] = useState("");
  const papers = usePapers({ status: status || undefined, search: query });
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = papers.data ?? [];

  const exportList = async () => {
    setError(null);
    try {
      await exportBib(list, "studyos-papers.bib");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Papers"
        subtitle="Your reading library: summaries, reading notes, PDFs and citations, ready for any project or thesis."
        actions={
          <>
            <Button icon={<FileUp className="size-4" />} onClick={() => setImporting(true)}>
              Import BibTeX
            </Button>
            <Button icon={<Download className="size-4" />} disabled={!list.length} onClick={() => void exportList()}>
              Export BibTeX
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Add paper
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Reading status" className="flex gap-1">
          {([["", "All"], ...PAPER_STATUSES.map((s) => [s, PAPER_STATUS_LABELS[s]])] as [PaperStatus | "", string][]).map(([id, label]) => (
            <button
              key={id || "all"}
              role="tab"
              type="button"
              aria-selected={status === id}
              onClick={() => setStatus(id)}
              className={clsx("rounded-full px-3 py-1 text-sm", status === id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-fg")}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <span className="sr-only">Filter papers</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, author, venue, year…" className="h-9 w-full rounded-md border border-border bg-surface pr-3 pl-9 text-sm focus:border-accent focus:outline-none" />
        </label>
      </div>
      {error && <p className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Card>
        {papers.isPending ? (
          <Spinner />
        ) : papers.error ? (
          <ErrorState error={papers.error} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-5" />}
            title={query || status ? "No matching papers" : "No papers yet"}
            description="Add a paper by DOI, enter it by hand, or import a .bib file from your reference manager."
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((p) => (
              <PaperRow key={p.id} paper={p} />
            ))}
          </ul>
        )}
      </Card>
      <PaperForm open={adding} onClose={() => setAdding(false)} onSaved={(p) => navigate(`/papers/${p.id}`)} />
      <BibtexImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}
