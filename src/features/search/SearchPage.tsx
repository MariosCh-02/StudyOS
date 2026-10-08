import { Fragment, useDeferredValue, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import clsx from "clsx";
import { Hash, Search as SearchIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, EmptyState, Spinner } from "@/components/ui/Feedback";
import { useSearch, useTaggedItems, useTags } from "@/hooks/queries";
import { keys } from "@/lib/platform";
import { resultHref, SEARCH_TYPE_LABELS, type SearchResult, type SearchType } from "@/services/search";

/** Renders a snippet whose matches are wrapped in [[ ]] as <mark>. */
export function Snippet({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/\[\[|\]\]/);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-accent-soft px-0.5 text-fg">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </span>
  );
}

export function useOpenResult() {
  const navigate = useNavigate();
  return async (r: Pick<SearchResult, "type" | "id">) => navigate(await resultHref(r));
}

const TYPE_ORDER: SearchType[] = ["concept", "course", "lecture", "note", "lesson", "assignment", "exam", "task", "formula", "flashcard", "question", "attachment", "event", "series"];

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const deferred = useDeferredValue(query);
  const [types, setTypes] = useState<SearchType[]>([]);
  const tag = params.get("tag") ?? "";
  const results = useSearch(deferred, { types: types.length ? types : undefined, tag: tag || undefined, limit: 100 });
  const tagged = useTaggedItems(!deferred.trim() ? tag : "");
  const tags = useTags();
  const open = useOpenResult();

  const grouped = TYPE_ORDER.map((t) => [t, (results.data ?? []).filter((r) => r.type === t)] as const).filter(([, list]) => list.length);
  const toggleType = (t: SearchType) => setTypes((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));
  const setTag = (t: string) => setParams(t ? { ...(query ? { q: query } : {}), tag: t } : query ? { q: query } : {}, { replace: true });

  return (
    <>
      <PageHeader title="Search" subtitle="Everything in StudyOS: courses, lectures, notes, files, assignments, exams, flashcards, questions, formulas, tasks and the knowledge base." />
      <label className="relative mb-4 block">
        <span className="sr-only">Search</span>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setParams(e.target.value ? { q: e.target.value, ...(tag ? { tag } : {}) } : tag ? { tag } : {}, { replace: true });
          }}
          placeholder="Search… (prefixes work: “grad desc”)"
          className="h-12 w-full rounded-lg border border-border bg-surface pr-4 pl-11 text-base placeholder:text-subtle focus:border-accent focus:outline-none"
        />
      </label>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TYPE_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={types.includes(t)}
            onClick={() => toggleType(t)}
            className={clsx("rounded-full border px-2.5 py-1 text-xs", types.includes(t) ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-fg")}
          >
            {SEARCH_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_14rem] items-start gap-6">
        <div>
          {!deferred.trim() && !tag ? (
            <Card>
              <EmptyState icon={<SearchIcon className="size-5" />} title="Type to search" description={keys("Every word must match. Results are ranked with title matches first. Press Ctrl+K anywhere for quick search.")} />
            </Card>
          ) : !deferred.trim() && tag ? (
            <Card>
              <h2 className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">Tagged #{tag}</h2>
              {tagged.isPending ? (
                <Spinner />
              ) : (tagged.data ?? []).length === 0 ? (
                <p className="px-4 pb-4 text-sm text-subtle">Nothing has this tag yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(tagged.data ?? []).map((i) => (
                    <li key={`${i.type}:${i.id}`}>
                      <button type="button" onClick={() => void open({ type: i.type as SearchType, id: i.id })} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2">
                        <span className="w-28 shrink-0 text-xs text-subtle">{SEARCH_TYPE_LABELS[i.type as SearchType] ?? i.type}</span>
                        <span className="truncate text-sm">{i.title || "Untitled"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : results.isPending ? (
            <Spinner />
          ) : grouped.length === 0 ? (
            <Card>
              <EmptyState icon={<SearchIcon className="size-5" />} title="No results" description={`Nothing matches “${deferred}”${tag ? ` with #${tag}` : ""}.`} />
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              {grouped.map(([type, list]) => (
                <Card key={type}>
                  <h2 className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                    {SEARCH_TYPE_LABELS[type]} · {list.length}
                  </h2>
                  <ul className="divide-y divide-border">
                    {list.map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => void open(r)} className="block w-full px-4 py-2.5 text-left hover:bg-surface-2">
                          <span className="block truncate text-sm font-medium">{r.title || "Untitled"}</span>
                          <Snippet text={r.snippet} className="line-clamp-2 text-[13px] text-muted" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </div>
        <Card>
          <h2 className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
            <Hash className="size-3.5" aria-hidden /> Tags
          </h2>
          {(tags.data ?? []).filter((t) => t.count > 0).length === 0 ? (
            <p className="px-4 pb-3 text-xs text-subtle">No tags in use yet. Type #confusing in a note, or add tags to lectures, assignments and flashcards.</p>
          ) : (
            <ul className="pb-2">
              {(tags.data ?? [])
                .filter((t) => t.count > 0)
                .map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      aria-pressed={tag === t.name}
                      onClick={() => setTag(tag === t.name ? "" : t.name)}
                      className={clsx("flex w-full justify-between px-4 py-1 text-sm", tag === t.name ? "bg-accent-soft text-accent" : "hover:bg-surface-2")}
                    >
                      <span>#{t.name}</span>
                      <span className="text-xs text-subtle tabular-nums">{t.count}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
