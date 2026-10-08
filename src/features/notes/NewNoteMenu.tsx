import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FileText, LayoutTemplate, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useTemplates } from "@/hooks/queries";
import { fillTemplate, lectureTemplateDoc, parseDoc, type DocNode } from "@/domain/noteContent";
import { toDateKey, formatDate } from "@/domain/dates";
import { createNote } from "@/services/notes";
import { getCourse } from "@/services/courses";

interface Props {
  courseId?: string | null;
  size?: "sm" | "md";
}

/** "New note" split button: blank, the built-in lecture template, or a custom template. */
export function NewNoteMenu({ courseId, size = "md" }: Props) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const templates = useTemplates();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const create = async (doc?: DocNode, title = "") => {
    setOpen(false);
    setBusy(true);
    setError(null);
    try {
      const course = courseId ? await getCourse(courseId) : null;
      const filled = doc && fillTemplate(doc, { title: title || "Topic", course: course?.name ?? "", date: formatDate(toDateKey(new Date())), number: "" });
      const note = await createNote({ courseId: courseId ?? null, title, doc: filled });
      await client.invalidateQueries({ queryKey: ["notes"] });
      navigate(`/notes/${note.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={root} className="relative">
      <div className="flex">
        <Button size={size} variant="primary" icon={<Plus className="size-4" />} loading={busy} onClick={() => void create()} className="rounded-r-none">
          New note
        </Button>
        <Button size={size} variant="primary" aria-label="New note from template" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded-l-none border-l border-accent-fg/20 px-2">
          <ChevronDown className="size-4" />
        </Button>
      </div>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-xl">
          <button role="menuitem" type="button" onClick={() => void create()} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2">
            <FileText className="size-4 text-muted" /> Blank note
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => void create(lectureTemplateDoc(null, "Lecture — Topic"))}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
          >
            <LayoutTemplate className="size-4 text-muted" /> Lecture template
          </button>
          {(templates.data ?? []).length > 0 && <div className="my-1 border-t border-border" />}
          {(templates.data ?? []).map((t) => (
            <button
              key={t.id}
              role="menuitem"
              type="button"
              onClick={() => void create(parseDoc(t.content))}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              <LayoutTemplate className="size-4 text-accent" /> <span className="truncate">{t.name}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="absolute right-0 mt-1 w-64 rounded bg-danger-soft px-2 py-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
