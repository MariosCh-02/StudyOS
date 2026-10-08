import { useEffect, useMemo, useState } from "react";
import katex from "katex";
import { FormModal } from "@/components/ui/Modal";
import { TextAreaField } from "@/components/ui/Field";

interface Props {
  open: boolean;
  display: boolean;
  initial: string;
  onClose: () => void;
  onSubmit: (latex: string) => void;
  onDelete?: () => void;
}

/** LaTeX editor with a live KaTeX preview. */
export function MathDialog({ open, display, initial, onClose, onSubmit, onDelete }: Props) {
  const [latex, setLatex] = useState(initial);
  useEffect(() => {
    if (open) setLatex(initial);
  }, [open, initial]);

  const preview = useMemo(() => {
    try {
      return { html: katex.renderToString(latex || "\\;", { displayMode: display, throwOnError: true, trust: false }), error: null };
    } catch (err) {
      return { html: "", error: err instanceof Error ? err.message.replace(/^KaTeX parse error: /, "") : "Invalid LaTeX" };
    }
  }, [latex, display]);

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={display ? "Equation" : "Inline maths"}
      submitLabel={initial ? "Update" : "Insert"}
      onSubmit={() => latex.trim() && onSubmit(latex.trim())}
    >
      <TextAreaField
        label="LaTeX"
        autoFocus
        rows={display ? 4 : 2}
        className="font-mono"
        placeholder={display ? "\\theta_{new} = \\theta - \\alpha \\nabla J(\\theta)" : "x^2"}
        value={latex}
        onChange={(e) => setLatex(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (latex.trim()) onSubmit(latex.trim());
          }
        }}
        hint="Ctrl+Enter to insert"
      />
      <div className="min-h-16 overflow-x-auto rounded-md border border-border bg-surface-2 px-4 py-3">
        {preview.error ? (
          <p className="text-xs text-danger">{preview.error}</p>
        ) : (
          <div className="text-fg" dangerouslySetInnerHTML={{ __html: preview.html }} />
        )}
      </div>
      {onDelete && (
        <button type="button" onClick={onDelete} className="self-start text-xs text-danger hover:underline">
          Remove this {display ? "equation" : "formula"}
        </button>
      )}
    </FormModal>
  );
}
