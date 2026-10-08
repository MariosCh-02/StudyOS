import { useState, type FormEvent } from "react";
import clsx from "clsx";
import { Check, X } from "lucide-react";
import { newId } from "@/lib/ids";

export interface ChecklistEntry {
  id: string;
  text: string;
  done: boolean;
}

interface Props {
  items: ChecklistEntry[];
  onChange: (items: ChecklistEntry[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

/** Editable checklist: toggle, add (Enter), remove. Changes are reported immediately. */
export function Checklist({ items, onChange, placeholder = "Add an item…", disabled }: Props) {
  const [text, setText] = useState("");
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onChange([...items, { id: newId(), text: text.trim(), done: false }]);
    setText("");
  };
  return (
    <div>
      <ul className="space-y-0.5">
        {items.map((i) => (
          <li key={i.id} className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-2">
            <button
              type="button"
              role="checkbox"
              aria-checked={i.done}
              aria-label={i.text}
              disabled={disabled}
              onClick={() => onChange(items.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)))}
              className={clsx("flex size-4 shrink-0 items-center justify-center rounded border", i.done ? "border-success bg-success text-white" : "border-border")}
            >
              {i.done && <Check className="size-3" />}
            </button>
            <span className={clsx("flex-1 text-sm", i.done && "text-subtle line-through")}>{i.text}</span>
            <button
              type="button"
              aria-label={`Remove ${i.text}`}
              disabled={disabled}
              onClick={() => onChange(items.filter((x) => x.id !== i.id))}
              className="text-subtle opacity-0 group-hover:opacity-100 hover:text-danger focus:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-1">
        <input
          aria-label={placeholder}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="h-8 w-full rounded-md border border-transparent bg-transparent px-1 text-sm placeholder:text-subtle hover:border-border focus:border-accent focus:outline-none"
        />
      </form>
    </div>
  );
}
