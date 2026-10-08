import { useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Hash, X } from "lucide-react";
import { useTagLinks, useTags } from "@/hooks/queries";
import { normaliseTag, setTags, SUGGESTED_TAGS, type TaggableType } from "@/services/tags";

/**
 * Tags on an item. Manual tags can be added (Enter/comma) and removed;
 * #hashtags typed in a note's text show as read-only chips.
 */
export function TagPicker({ type, id, compact }: { type: TaggableType; id: string; compact?: boolean }) {
  const client = useQueryClient();
  const links = useTagLinks(type, id);
  const all = useTags();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manual = (links.data ?? []).filter((l) => l.source === "manual").map((l) => l.name);
  const inline = (links.data ?? []).filter((l) => l.source === "inline" && !manual.includes(l.name)).map((l) => l.name);

  const save = async (names: string[]) => {
    setError(null);
    try {
      await setTags(type, id, names);
      await client.invalidateQueries({ queryKey: ["tagLinks", type, id] });
      await client.invalidateQueries({ queryKey: ["tags"] });
      await client.invalidateQueries({ queryKey: ["tagged"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const add = (name: string) => {
    const n = normaliseTag(name);
    if (!n || manual.includes(n)) return;
    setText("");
    void save([...manual, n]);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(text);
    } else if (e.key === "Backspace" && !text && manual.length) {
      void save(manual.slice(0, -1));
    }
  };

  const suggestions = [...new Set([...SUGGESTED_TAGS, ...(all.data ?? []).map((t) => t.name)])].filter((t) => !manual.includes(t) && !inline.includes(t) && t.startsWith(normaliseTag(text))).slice(0, 8);

  return (
    <div className="relative flex flex-wrap items-center gap-1">
      {manual.map((t) => (
        <span key={t} className="flex items-center gap-0.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
          #{t}
          <button type="button" aria-label={`Remove tag ${t}`} onClick={() => void save(manual.filter((x) => x !== t))} className="hover:text-fg">
            <X className="size-3" />
          </button>
        </span>
      ))}
      {inline.map((t) => (
        <span key={t} title="From the note text" className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted">
          #{t}
        </span>
      ))}
      <span className="relative flex items-center">
        <Hash className="pointer-events-none absolute left-1.5 size-3 text-subtle" aria-hidden />
        <input
          aria-label="Add tag"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={compact ? "tag" : "Add tag"}
          className={clsx("h-6 rounded-full border border-transparent bg-transparent pr-2 pl-5 text-[11px] placeholder:text-subtle hover:border-border focus:border-accent focus:outline-none", compact ? "w-16 focus:w-28" : "w-24 focus:w-32")}
        />
        {open && suggestions.length > 0 && (
          <ul role="listbox" className="absolute top-7 left-0 z-30 w-40 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg">
            {suggestions.map((s) => (
              <li key={s}>
                <button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)} className="w-full px-2.5 py-1 text-left text-xs hover:bg-surface-2">
                  #{s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </span>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}
