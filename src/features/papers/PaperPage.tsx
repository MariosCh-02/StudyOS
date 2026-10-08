import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Sparkles, FileText, NotebookPen, Pencil, Plus, Quote, Star, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader, EmptyState, ErrorState, Spinner } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { SelectField } from "@/components/ui/Field";
import { Markdown } from "@/components/Markdown";
import { usePaper, useProjects, useProjectsForPaper } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { openExternal } from "@/lib/links";
import { doiUrl, formatApa, inTextCitation } from "@/domain/research";
import {
  addPaperToProject,
  deletePaper,
  ENTRY_TYPE_LABELS,
  getOrCreatePaperNote,
  PAPER_STATUS_LABELS,
  PAPER_STATUSES,
  paperToBibtex,
  patchPaper,
  removePaperFromProject,
  type Paper,
  type PaperStatus,
} from "@/services/papers";
import { AttachmentList } from "@/features/attachments/AttachmentList";
import { ConceptsCard } from "@/features/knowledge/KnowledgePages";
import { PaperForm } from "./PaperForm";
import { paperByline } from "./PaperParts";
import { useAiEnabled } from "@/features/ai/AiParts";
import { aiPaperSummary } from "@/services/ai";
import { getNote, listNotes } from "@/services/notes";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <IconButton
      label={copied ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </IconButton>
  );
}

function SummaryCard({ paper }: { paper: Paper }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(paper.summary ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const aiEnabled = useAiEnabled();
  useEffect(() => {
    setText(paper.summary ?? "");
  }, [paper.id, paper.summary]);
  const draftWithAi = async () => {
    setDrafting(true);
    setError(null);
    try {
      const [first] = await listNotes({ paperId: paper.id, limit: 1 });
      const notes = first ? ((await getNote(first.id))?.contentText ?? null) : null;
      const r = await aiPaperSummary(paper, notes);
      const draft = `_${r.label}_\n\n${r.text}`;
      setText((t) => (t.trim() ? `${t.trim()}\n\n${draft}` : draft));
      setEditing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrafting(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await patchPaper(paper.id, { summary: text });
      await client.invalidateQueries();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title="My summary"
        action={
          editing ? (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setText(paper.summary ?? "");
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>
                Save
              </Button>
            </div>
          ) : (
            <div className="flex gap-1">
              {aiEnabled && (
                <Button size="sm" variant="ghost" icon={<Sparkles className="size-3.5 text-accent" />} loading={drafting} onClick={() => void draftWithAi()}>
                  Draft with AI
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
                {paper.summary ? "Edit" : "Write"}
              </Button>
            </div>
          )
        }
      />
      <div className="px-4 pb-4">
        {editing ? (
          <textarea
            aria-label="Summary"
            autoFocus
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="In your own words: the problem, the idea, the evidence and why it matters to you. Markdown and $maths$ work."
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        ) : paper.summary ? (
          <Markdown source={paper.summary} className="text-sm" />
        ) : (
          <p className="text-[13px] text-subtle">A short summary in your own words makes the paper easy to cite and revisit. Longer notes go in Reading notes.</p>
        )}
        {editing && aiEnabled && /AI-generated with/.test(text) && <p className="mt-2 text-xs text-muted">The AI draft uses only the abstract and your reading notes. Edit it before saving; the AI label is kept with it.</p>}
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    </Card>
  );
}

function CiteCard({ paper }: { paper: Paper }) {
  const apa = formatApa(paper);
  const bib = paperToBibtex(paper);
  return (
    <Card>
      <CardHeader title="Cite" icon={<Quote className="size-3.5" />} />
      <div className="flex flex-col gap-3 px-4 pb-4 text-sm">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-muted">
            APA 7 <CopyButton text={apa.plain} label="Copy APA reference" />
          </div>
          <Markdown source={apa.markdown} className="text-sm" />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-muted">
            In text <CopyButton text={inTextCitation(paper)} label="Copy in-text citation" />
          </div>
          <p>{inTextCitation(paper)}</p>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-muted">
            BibTeX <CopyButton text={bib} label="Copy BibTeX" />
          </div>
          <pre className="overflow-x-auto rounded-md bg-surface-2 p-3 text-xs">{bib}</pre>
        </div>
      </div>
    </Card>
  );
}

function PaperProjectsCard({ paperId }: { paperId: string }) {
  const client = useQueryClient();
  const used = useProjectsForPaper(paperId);
  const all = useProjects({ status: "open" });
  const [choice, setChoice] = useState("");
  const usedIds = new Set((used.data ?? []).map((p) => p.id));
  const options = (all.data ?? []).filter((p) => !usedIds.has(p.id));
  const add = async () => {
    if (!choice) return;
    await addPaperToProject(choice, paperId);
    setChoice("");
    await client.invalidateQueries();
  };
  const remove = async (projectId: string) => {
    await removePaperFromProject(projectId, paperId);
    await client.invalidateQueries();
  };
  return (
    <Card>
      <CardHeader title="Used in projects" />
      <div className="px-4 pb-4">
        {(used.data ?? []).length > 0 && (
          <ul className="mb-3 flex flex-col gap-1">
            {used.data!.map((p) => (
              <li key={p.id} className="group flex items-center gap-2 text-sm">
                <Link to={`/projects/${p.id}?tab=papers`} className="min-w-0 flex-1 truncate hover:text-accent">
                  {p.title}
                </Link>
                <IconButton label={`Remove from ${p.title}`} onClick={() => void remove(p.id)} className="size-6 opacity-0 group-hover:opacity-100 focus:opacity-100">
                  <X className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        {options.length > 0 ? (
          <div className="flex items-end gap-2">
            <SelectField label="Add to project" className="flex-1 [&_label]:sr-only" value={choice} onChange={(e) => setChoice(e.target.value)} options={[{ value: "", label: "Add to a project…" }, ...options.map((p) => ({ value: p.id, label: p.title }))]} />
            <IconButton label="Add to project" onClick={() => void add()}>
              <Plus className="size-4" />
            </IconButton>
          </div>
        ) : (
          (used.data ?? []).length === 0 && <p className="text-[13px] text-subtle">No open projects to add it to.</p>
        )}
      </div>
    </Card>
  );
}

export default function PaperPage() {
  const { paperId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const paper = usePaper(paperId);
  const [editing, setEditing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useConfirmAction((p: Paper) => deletePaper(p.id), () => navigate("/papers"));

  if (paper.isPending) return <Spinner />;
  if (paper.error) return <ErrorState error={paper.error} />;
  const p = paper.data;
  if (!p) return <EmptyState icon={<FileText className="size-5" />} title="Paper not found" action={<Button onClick={() => navigate("/papers")}>Back to Papers</Button>} />;

  const patch = async (change: Parameters<typeof patchPaper>[1]) => {
    setError(null);
    try {
      await patchPaper(p.id, change);
      await client.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const openNotes = async () => {
    setOpening(true);
    try {
      const note = await getOrCreatePaperNote(p.id);
      navigate(`/notes/${note.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setOpening(false);
    }
  };

  const link = p.doi ? doiUrl(p.doi) : p.url;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/papers" className="hover:text-fg">
            Papers
          </Link>
        }
        title={p.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{p.authors.join("; ") || "No authors yet"}</span>
            <span>{[p.year, p.venue, ENTRY_TYPE_LABELS[p.entryType] ?? p.entryType].filter(Boolean).join(" · ")}</span>
            {link && (
              <button type="button" onClick={() => void openExternal(link)} className="flex items-center gap-1 text-accent hover:underline">
                <ExternalLink className="size-3.5" aria-hidden /> {p.doi ? `doi:${p.doi}` : "Open link"}
              </button>
            )}
          </span>
        }
        actions={
          <>
            <SelectField
              label="Reading status"
              className="w-32 [&_label]:sr-only"
              value={p.status}
              onChange={(e) => void patch({ status: e.target.value as PaperStatus })}
              options={PAPER_STATUSES.map((s) => ({ value: s, label: PAPER_STATUS_LABELS[s] }))}
            />
            <Button variant="primary" icon={<NotebookPen className="size-4" />} loading={opening} onClick={() => void openNotes()}>
              Reading notes
            </Button>
            <IconButton label="Edit paper" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Delete paper" onClick={() => remove.ask(p)}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        }
      />
      <div className="-mt-3 mb-5 flex items-center gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={p.rating === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => void patch({ rating: p.rating === n ? null : n })}
            className="text-warning hover:scale-110"
          >
            <Star className={(p.rating ?? 0) >= n ? "size-4 fill-current" : "size-4 text-subtle"} />
          </button>
        ))}
        <span className="ml-2 text-xs text-subtle">{paperByline(p)}</span>
      </div>
      {error && <p className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="grid grid-cols-[1fr_22rem] items-start gap-6">
        <div className="flex flex-col gap-5">
          <SummaryCard key={p.id} paper={p} />
          {p.abstract && (
            <Card>
              <CardHeader title="Abstract" />
              <p className="px-4 pb-4 text-sm whitespace-pre-wrap text-muted">{p.abstract}</p>
            </Card>
          )}
          <CiteCard paper={p} />
        </div>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="PDF and files" />
            <div className="px-2 pb-2">
              <AttachmentList owner={{ type: "paper", id: p.id }} onView={(f) => navigate(`/files/${f.id}`)} compact />
            </div>
          </Card>
          <PaperProjectsCard paperId={p.id} />
          <ConceptsCard type="paper" id={p.id} />
        </div>
      </div>

      <PaperForm open={editing} onClose={() => setEditing(false)} paper={p} />
      <ConfirmDialog
        open={remove.target != null}
        title="Delete paper?"
        busy={remove.busy} error={remove.error}
        onClose={remove.cancel}
        onConfirm={remove.confirm}
        message={<p>“{p.title}”, its PDF, files and reading notes will be removed, and it will leave every project's literature list.</p>}
      />
    </>
  );
}
