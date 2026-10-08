import { useEffect, useMemo, useState } from "react";
import { ShowMore, usePaged } from "@/components/ShowMore";
import { useNavigate, useSearchParams } from "react-router";
import { Layers, Pencil, Play, Plus, Search, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, EmptyState, ErrorState, Spinner, Stat } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { Markdown } from "@/components/Markdown";
import { useAllCourses, useDueCounts, useFlashcards } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { formatInterval } from "@/domain/srs";
import { toDateKey } from "@/domain/dates";
import { deleteFlashcard, listFlashcards, type Flashcard } from "@/services/practice";
import { FlashcardForm } from "./FlashcardForm";
import { ReviewSession } from "./ReviewSession";
import { ExportMenu } from "@/components/ExportMenu";
import { flashcardExports } from "@/features/export/exportItems";

/** New cards introduced per review session, so a big deck doesn't arrive all at once. */
export const NEW_CARDS_PER_SESSION = 20;

/** Due cards first, then up to NEW_CARDS_PER_SESSION new ones. */
export function reviewQueue(cards: Flashcard[]): Flashcard[] {
  const due = cards.filter((c) => c.dueDate != null);
  const fresh = cards.filter((c) => c.dueDate == null).slice(0, NEW_CARDS_PER_SESSION);
  return [...due, ...fresh];
}

/** /flashcards/review?course=&topic=&lesson= */
export function FlashcardReviewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    listFlashcards({
      dueBy: toDateKey(new Date()),
      courseId: params.get("course") ?? undefined,
      topicId: params.get("topic") ?? undefined,
      lessonId: params.get("lesson") ?? undefined,
    }).then((c) => setCards(reviewQueue(c)), setError);
  }, [params]);
  if (error) return <ErrorState error={error} />;
  if (!cards) return <Spinner />;
  return (
    <>
      <PageHeader title="Flashcard review" subtitle={`${cards.length} card${cards.length === 1 ? "" : "s"} in this session`} />
      {cards.length === 0 ? (
        <Card>
          <EmptyState icon={<Layers className="size-5" />} title="Nothing due" description="All caught up. Come back tomorrow, or add new cards." action={<Button onClick={() => navigate("/flashcards")}>Back to flashcards</Button>} />
        </Card>
      ) : (
        <ReviewSession cards={cards} onDone={() => navigate("/flashcards")} />
      )}
    </>
  );
}

export default function FlashcardsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [courseId, setCourseId] = useState("");
  const cards = useFlashcards({ search: search || undefined, courseId: courseId || undefined });
  const page = usePaged(300, `${search}|${courseId}`);
  const counts = useDueCounts();
  const courses = useAllCourses();
  const [editing, setEditing] = useState<Flashcard | null>(null);
  const [creating, setCreating] = useState(false);
  const remove = useConfirmAction((c: Flashcard) => deleteFlashcard(c.id));
  const createDefaults = useMemo(() => (courseId ? { courseId } : undefined), [courseId]);
  const courseName = useMemo(() => new Map((courses.data ?? []).map((c) => [c.id, c.code ?? c.name])), [courses.data]);
  const today = toDateKey(new Date());
  const toReview = (counts.data?.cardsDue ?? 0) + Math.min(counts.data?.cardsNew ?? 0, NEW_CARDS_PER_SESSION);

  return (
    <>
      <PageHeader
        title="Flashcards"
        subtitle="Spaced repetition: cards come back just before you'd forget them."
        actions={
          <>
            <ExportMenu items={flashcardExports()} />
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New card
            </Button>
            <Button variant="primary" icon={<Play className="size-4" />} disabled={toReview === 0} onClick={() => navigate(`/flashcards/review${courseId ? `?course=${courseId}` : ""}`)}>
              Review {toReview > 0 ? toReview : ""}
            </Button>
          </>
        }
      />
      <Card className="mb-5 grid grid-cols-3 gap-6 p-5">
        <Stat label="Due today" value={counts.data?.cardsDue ?? "—"} />
        <Stat label="New" value={counts.data?.cardsNew ?? "—"} sub={`Up to ${NEW_CARDS_PER_SESSION} per session`} />
        <Stat label="Total cards" value={cards.data?.length ?? "—"} sub={search || courseId ? "matching filters" : undefined} />
      </Card>
      <div className="mb-4 flex gap-3">
        <label className="relative flex-1">
          <span className="sr-only">Search cards</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search cards…" className="h-9 w-full rounded-md border border-border bg-surface pr-3 pl-9 text-sm focus:border-accent focus:outline-none" />
        </label>
        <select aria-label="Filter by course" value={courseId} onChange={(e) => setCourseId(e.target.value)} className="h-9 w-60 rounded-md border border-border bg-surface px-2 text-sm focus:border-accent focus:outline-none">
          <option value="">All courses</option>
          {(courses.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.code ? `${c.code} · ${c.name}` : c.name}
            </option>
          ))}
        </select>
      </div>
      <Card>
        {cards.isPending ? (
          <Spinner />
        ) : (cards.data ?? []).length === 0 ? (
          <EmptyState
            icon={<Layers className="size-5" />}
            title="No flashcards yet"
            description="Create cards here, from a note (toolbar → Flashcard), from a lesson, or install a content pack."
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                New card
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {(cards.data ?? []).slice(0, page.limit).map((c) => (
              <li key={c.id} className="group grid grid-cols-[1fr_1fr_8rem_auto] items-start gap-4 px-4 py-3">
                <Markdown source={c.front} className="text-sm" />
                <Markdown source={c.back} className="text-sm text-muted" />
                <div className="text-xs text-subtle">
                  {c.dueDate == null ? "New" : c.dueDate <= today ? "Due" : `In ${formatInterval(Math.max(1, Math.round((Date.parse(c.dueDate) - Date.parse(today)) / 86_400_000)))}`}
                  {c.courseId && <p>{courseName.get(c.courseId)}</p>}
                  {c.topicName && <p>{c.topicName}</p>}
                </div>
                <div className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton label="Edit card" onClick={() => setEditing(c)}>
                    <Pencil className="size-3.5" />
                  </IconButton>
                  <IconButton label="Delete card" onClick={() => remove.ask(c)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
        {(cards.data?.length ?? 0) > page.limit && <ShowMore shown={page.limit} total={cards.data!.length} onMore={page.more} />}
      </Card>
      <FlashcardForm open={creating} defaults={createDefaults} onClose={() => setCreating(false)} />
      <FlashcardForm open={editing != null} card={editing ?? undefined} onClose={() => setEditing(null)} />
      <ConfirmDialog open={remove.target != null} title="Delete flashcard?" busy={remove.busy} error={remove.error} onClose={remove.cancel} onConfirm={remove.confirm} message={<p>The card and its review history will be removed.</p>} />
    </>
  );
}
