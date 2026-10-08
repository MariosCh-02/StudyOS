import { useState } from "react";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Check, Copy } from "lucide-react";

export const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: "plaintext", label: "Plain text" },
  { value: "python", label: "Python" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "rust", label: "Rust" },
  { value: "sql", label: "SQL" },
  { value: "bash", label: "Bash" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
];

/** Code block with a language picker and a copy button. */
export function CodeBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const [copied, setCopied] = useState(false);
  const language = (node.attrs.language as string | null) ?? "plaintext";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; nothing else to do.
    }
  };

  return (
    <NodeViewWrapper className="code-block group relative my-3">
      <div contentEditable={false} className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 opacity-70 group-hover:opacity-100">
        {editor.isEditable && (
          <select
            aria-label="Code language"
            value={language}
            onChange={(e) => updateAttributes({ language: e.target.value })}
            className="h-6 rounded border border-border bg-surface px-1 text-[11px] text-muted focus:outline-none"
          >
            {CODE_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => void copy()}
          className="flex h-6 items-center gap-1 rounded border border-border bg-surface px-1.5 text-[11px] text-muted hover:text-fg"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <NodeViewContent<"code"> as="code" className={`hljs language-${language}`} />
      </pre>
    </NodeViewWrapper>
  );
}
