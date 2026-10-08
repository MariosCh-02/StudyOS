import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import clsx from "clsx";
import { MessageCircleQuestion, Search } from "lucide-react";
import { useSearch } from "@/hooks/queries";
import { SEARCH_TYPE_LABELS } from "@/services/search";
import { Snippet, useOpenResult } from "./SearchPage";

/** Ctrl+K quick search from anywhere. Enter opens the highlighted result. */
export function CommandPalette() {
  const navigate = useNavigate();
  const open = useOpenResult();
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const results = useSearch(visible ? query : "", { limit: 8 });
  const list = query.trim() ? (results.data ?? []) : [];
  // Last row: ask the question, or see all results.
  const isQuestion = /\?$|^(when|what|which|who|how|show)\b/i.test(query.trim());
  const rows = list.length + (query.trim() ? 1 : 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setVisible(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (visible && !d.open) d.showModal();
    if (!visible && d.open) d.close();
    if (visible) {
      setQuery("");
      setIndex(0);
    }
  }, [visible]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  const choose = (i: number) => {
    setVisible(false);
    if (i < list.length) void open(list[i]!);
    else navigate(isQuestion ? `/ask?q=${encodeURIComponent(query)}` : `/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        setVisible(false);
      }}
      onClick={(e) => e.target === e.currentTarget && setVisible(false)}
      className="mx-auto mt-[12vh] w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface p-0 text-fg shadow-2xl"
    >
      {visible && (
        <div>
          <label className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-5 text-subtle" aria-hidden />
            <span className="sr-only">Quick search</span>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setIndex((i) => Math.min(rows - 1, i + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setIndex((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter" && rows > 0) {
                  e.preventDefault();
                  choose(index);
                }
              }}
              placeholder="Search everything, or ask a question…"
              className="h-14 flex-1 bg-transparent text-base placeholder:text-subtle focus:outline-none"
            />
            <kbd className="rounded border border-border px-1.5 text-[10px] text-subtle">Esc</kbd>
          </label>
          {rows > 0 && (
            <ul role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
              {list.map((r, i) => (
                <li key={`${r.type}:${r.id}`} role="option" aria-selected={i === index}>
                  <button type="button" onMouseEnter={() => setIndex(i)} onClick={() => choose(i)} className={clsx("flex w-full items-start gap-3 px-4 py-2 text-left", i === index && "bg-surface-2")}>
                    <span className="mt-0.5 w-24 shrink-0 text-[11px] text-subtle">{SEARCH_TYPE_LABELS[r.type]}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{r.title || "Untitled"}</span>
                      <Snippet text={r.snippet} className="line-clamp-1 text-xs text-muted" />
                    </span>
                  </button>
                </li>
              ))}
              <li role="option" aria-selected={index === list.length}>
                <button type="button" onMouseEnter={() => setIndex(list.length)} onClick={() => choose(list.length)} className={clsx("flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-accent", index === list.length && "bg-surface-2")}>
                  {isQuestion ? <MessageCircleQuestion className="size-4" aria-hidden /> : <Search className="size-4" aria-hidden />}
                  {isQuestion ? `Ask My Studies: “${query}”` : `See all results for “${query}”`}
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </dialog>
  );
}
