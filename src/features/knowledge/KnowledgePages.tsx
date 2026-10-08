import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Brain, FileText, FolderKanban, Layers, Lightbulb, Link2, Pencil, Play, Plus, Search, Sigma, StickyNote, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge, Card, CardHeader, EmptyState, ErrorState, ProgressBar, Spinner } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { Latex, Markdown } from "@/components/Markdown";
import { TagPicker } from "@/components/TagPicker";
import { useAllCourses, useEntries, useEntriesFor, useEntry, useLinkedItems, useTopicMastery } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { masteryBand } from "@/domain/mastery";
import { deleteEntry, flashcardsFromEntry, unlinkEntry, type KnowledgeEntry, type LinkedItem, type LinkTarget } from "@/services/knowledge";
import { ConceptForm, LinkDialog } from "./ConceptForms";

export default function KnowledgePage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [courseId, setCourseId] = useState("");
  const entries = useEntries({ search: search || undefined, courseId: courseId || undefined });
  const courses = useAllCourses();
  const [creating, setCreating] = useState(false);
  const courseName = new Map((courses.data ?? []).map((c) => [c.id, c.code ?? c.name]));

  return (
    <>
      <PageHeader
        title="Knowledge base"
        subtitle="Concepts that connect your courses: one page per idea, with its definition, formula, intuition, examples and everything related."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New concept
          </Button>
        }
      />
      <div className="mb-4 flex gap-3">
        <label className="relative flex-1">
          <span className="sr-only">Filter concepts</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter concepts…" className="h-9 w-full rounded-md border border-border bg-surface pr-3 pl-9 text-sm focus:border-accent focus:outline-none" />
        </label>
        <select aria-label="Course" value={courseId} onChange={(e) => setCourseId(e.target.value)} className="h-9 w-60 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none">
          <option value="">All courses</option>
          {(courses.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.code ? `${c.code} · ${c.name}` : c.name}
            </option>
          ))}
        </select>
      </div>
      {entries.isPending ? (
        <Spinner />
      ) : (entries.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<Lightbulb className="size-5" />}
            title={search || courseId ? "No matching concepts" : "No concepts yet"}
            description="Create concepts here, or select a term in a note and press the Concept button in the toolbar. The concept is linked to that note, its lecture and its course."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {(entries.data ?? []).map((e) => (
            <button key={e.id} type="button" onClick={() => navigate(`/knowledge/${e.id}`)} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-accent/60">
              <p className="font-medium">{e.title}</p>
              {e.definition && <Markdown source={e.definition.length > 180 ? `${e.definition.slice(0, 180)}…` : e.definition} className="line-clamp-3 text-[13px] text-muted" />}
              <p className="mt-auto text-xs text-subtle">
                {e.linkCount} link{e.linkCount === 1 ? "" : "s"}
                {e.courseIds.length > 0 && ` · ${e.courseIds.map((id) => courseName.get(id)).filter(Boolean).join(", ")}`}
              </p>
            </button>
          ))}
        </div>
      )}
      <ConceptForm open={creating} onClose={() => setCreating(false)} onSaved={(e) => navigate(`/knowledge/${e.id}`)} />
    </>
  );
}

const SECTIONS: { type: LinkTarget; label: string; icon: typeof BookOpen; href: (i: LinkedItem) => string }[] = [
  { type: "course", label: "Related courses", icon: BookOpen, href: (i) => `/studies/courses/${i.id}` },
  { type: "lecture", label: "Related lectures", icon: BookOpen, href: (i) => `/studies/lectures/${i.id}` },
  { type: "note", label: "My notes", icon: StickyNote, href: (i) => `/notes/${i.id}` },
  { type: "lesson", label: "Lessons", icon: BookOpen, href: (i) => `/practice/lessons/${i.id}` },
  { type: "formula", label: "Formulas", icon: Sigma, href: () => "/practice?tab=formulas" },
  { type: "flashcard", label: "Flashcards", icon: Layers, href: () => "/flashcards" },
  { type: "question", label: "Practice questions", icon: Brain, href: () => "/practice?tab=questions" },
  { type: "paper", label: "Papers", icon: FileText, href: (i) => `/papers/${i.id}` },
  { type: "project", label: "Projects", icon: FolderKanban, href: (i) => `/projects/${i.id}` },
];

export function ConceptPage() {
  const { entryId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const entry = useEntry(entryId);
  const linked = useLinkedItems(entryId);
  const mastery = useTopicMastery();
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const remove = useConfirmAction((e: KnowledgeEntry) => deleteEntry(e.id), () => navigate("/knowledge"));

  if (entry.isPending) return <Spinner />;
  if (entry.error) return <ErrorState error={entry.error} />;
  const e = entry.data;
  if (!e) return <EmptyState icon={<Lightbulb className="size-5" />} title="Concept not found" action={<Button onClick={() => navigate("/knowledge")}>Knowledge base</Button>} />;

  const items = linked.data ?? [];
  const m = mastery.data?.find((t) => t.topicId === e.topicId);
  const firstCourse = items.find((i) => i.type === "course")?.id ?? null;

  const makeCards = async () => {
    const n = await flashcardsFromEntry(e, firstCourse);
    await client.invalidateQueries();
    setMessage(n ? `Created ${n} flashcard${n === 1 ? "" : "s"}.` : "Add a definition or formula first.");
  };
  const unlink = async (i: LinkedItem) => {
    await unlinkEntry(e.id, i.type, i.id);
    await client.invalidateQueries({ queryKey: ["linked", e.id] });
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/knowledge" className="hover:text-fg">
            Knowledge base
          </Link>
        }
        title={e.title}
        subtitle={e.aliases.length ? `Also: ${e.aliases.join(", ")}` : undefined}
        actions={
          <>
            <Button icon={<Layers className="size-4" />} onClick={() => void makeCards()}>
              Make flashcards
            </Button>
            {e.topicId && (
              <Button variant="primary" icon={<Play className="size-4" />} onClick={() => navigate(`/practice/quiz?topic=${e.topicId}&title=${encodeURIComponent(e.title)}`)}>
                Practise
              </Button>
            )}
            <IconButton label="Edit concept" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Delete concept" onClick={() => remove.ask(e)}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        }
      />
      <div className="-mt-3 mb-5">
        <TagPicker type="concept" id={e.id} />
      </div>
      {message && <p className="mb-4 rounded-md bg-success-soft px-3 py-2 text-sm text-success">{message}</p>}

      <div className="grid grid-cols-[1fr_20rem] items-start gap-6">
        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Definition</h2>
            {e.definition ? <Markdown source={e.definition} /> : <p className="text-sm text-subtle">No definition yet.</p>}
            {e.formula && (
              <>
                <h2 className="mt-5 mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Formula</h2>
                <Latex latex={e.formula} />
              </>
            )}
            {e.intuition && (
              <>
                <h2 className="mt-5 mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Intuition</h2>
                <Markdown source={e.intuition} />
              </>
            )}
            {e.examples && (
              <>
                <h2 className="mt-5 mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Examples</h2>
                <Markdown source={e.examples} />
              </>
            )}
          </Card>
          {SECTIONS.filter((s) => items.some((i) => i.type === s.type)).map((s) => (
            <Card key={s.type}>
              <CardHeader title={s.label} icon={<s.icon className="size-3.5" />} />
              <ul className="divide-y divide-border">
                {items
                  .filter((i) => i.type === s.type)
                  .map((i) => (
                    <li key={i.id} className="group flex items-center gap-2 px-4 py-2">
                      <Link to={s.href(i)} className="min-w-0 flex-1 hover:text-accent">
                        {s.type === "flashcard" || s.type === "question" ? <Markdown source={i.title} className="line-clamp-2 text-sm" /> : <span className="block truncate text-sm">{i.title}</span>}
                        {i.detail && <span className="block text-xs text-subtle">{i.detail}</span>}
                      </Link>
                      <IconButton label="Unlink" onClick={() => void unlink(i)} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
                        <X className="size-3.5" />
                      </IconButton>
                    </li>
                  ))}
              </ul>
            </Card>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Mastery</p>
            {m?.mastery != null ? (
              <>
                <p className="mb-2 text-2xl font-semibold tabular-nums">
                  {m.mastery}% <Badge>{masteryBand(m.mastery)}</Badge>
                </p>
                <ProgressBar value={m.mastery / 100} label="Concept mastery" />
                <p className="mt-2 text-xs text-subtle">
                  {m.attempts} answers · {m.reviews} card reviews
                </p>
              </>
            ) : (
              <p className="text-sm text-subtle">Practise or review flashcards for this concept to measure mastery.</p>
            )}
          </Card>
          <Button icon={<Link2 className="size-4" />} onClick={() => setLinking(true)}>
            Link courses, lectures, notes…
          </Button>
          <p className="text-xs text-subtle">The same concept can be linked to several courses, which is how StudyOS connects what you learn across your degree.</p>
        </div>
      </div>

      <ConceptForm open={editing} entry={e} onClose={() => setEditing(false)} />
      <LinkDialog open={linking} onClose={() => setLinking(false)} entryId={e.id} />
      <ConfirmDialog open={remove.target != null} title="Delete concept?" busy={remove.busy} error={remove.error} onClose={remove.cancel} onConfirm={remove.confirm} message={<p>“{e.title}” and its links will be removed. The linked notes, flashcards and courses are not affected.</p>} />
    </>
  );
}

/** Small card listing the concepts linked to a lecture, course or note. */
export function ConceptsCard({ type, id }: { type: LinkTarget; id: string }) {
  const entries = useEntriesFor(type, id);
  if (!entries.data?.length) return null;
  return (
    <Card>
      <CardHeader title="Concepts" icon={<Lightbulb className="size-3.5" />} />
      <div className="flex flex-wrap gap-1.5 px-4 pb-4">
        {entries.data.map((e) => (
          <Link key={e.id} to={`/knowledge/${e.id}`} className="rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent hover:underline">
            {e.title}
          </Link>
        ))}
      </div>
    </Card>
  );
}
