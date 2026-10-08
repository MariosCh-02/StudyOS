import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { flushAll } from "@/lib/flush";

export interface ExportItem {
  label: string;
  hint?: string;
  /** Resolves to a message to show (e.g. "Saved"), or null when cancelled. */
  run: () => Promise<string | null | void>;
}

/** "Export" button with a list of formats; shows the result or error inline. */
export function ExportMenu({ items, size = "md", label = "Export" }: { items: ExportItem[]; size?: "sm" | "md"; label?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!message || message.error) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  const run = async (item: ExportItem) => {
    setOpen(false);
    setBusy(true);
    setMessage(null);
    try {
      await flushAll(); // save open notes first so the export has the latest text
      const r = await item.run();
      if (r) setMessage({ text: r, error: false });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={root} className="relative">
      <Button size={size} icon={<Download className="size-4" />} loading={busy} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-xl">
          {items.map((it) => (
            <button key={it.label} role="menuitem" type="button" onClick={() => void run(it)} className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2">
              {it.label}
              {it.hint && <span className="block text-xs text-subtle">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
      {message && (
        <p role="status" className={`absolute right-0 z-20 mt-1 w-max max-w-80 rounded-md px-2.5 py-1.5 text-xs shadow ${message.error ? "bg-danger-soft text-danger" : "bg-success-soft text-success"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
