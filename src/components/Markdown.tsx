import { useId, useMemo, useState } from "react";
import clsx from "clsx";
import { renderLatex, renderMarkdown } from "@/lib/markdown";
import "katex/dist/katex.min.css";
import "./markdown.css";

/** Renders trusted-safe Markdown + LaTeX (raw HTML is disabled in the renderer). */
export function Markdown({ source, className, inline }: { source: string; className?: string; inline?: boolean }) {
  const html = useMemo(() => renderMarkdown(source, { inline }), [source, inline]);
  const Tag = inline ? "span" : "div";
  return <Tag className={clsx(!inline && "md-content", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A single LaTeX expression (formula cards, previews). */
export function Latex({ latex, display = true, className }: { latex: string; display?: boolean; className?: string }) {
  const html = useMemo(() => renderLatex(latex, display), [latex, display]);
  return <span className={clsx(display && "block overflow-x-auto", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  error?: string;
  required?: boolean;
  hint?: string;
}

/** Markdown textarea with a Write / Preview toggle. */
export function MarkdownField({ label, value, onChange, rows = 4, placeholder, error, required, hint = "Markdown: **bold**, - lists, ```code```, $x^2$ and $$…$$ for maths." }: FieldProps) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-[13px] font-medium text-muted">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
        <div className="flex gap-1 text-[11px]">
          {(["Write", "Preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setPreview(t === "Preview")}
              className={clsx("rounded px-1.5 py-0.5", (t === "Preview") === preview ? "bg-surface-2 text-fg" : "text-subtle hover:text-fg")}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {preview ? (
        <div className="min-h-16 rounded-md border border-border bg-surface-2/40 px-3 py-2 text-sm">
          {value.trim() ? <Markdown source={value} /> : <span className="text-subtle">Nothing to preview.</span>}
        </div>
      ) : (
        <textarea
          id={id}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          className={clsx(
            "w-full resize-y rounded-md border bg-surface px-3 py-2 font-mono text-[13px] text-fg placeholder:text-subtle focus:border-accent focus:outline-none",
            error ? "border-danger" : "border-border",
          )}
        />
      )}
      {error ? <p className="text-xs text-danger">{error}</p> : <p className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}
