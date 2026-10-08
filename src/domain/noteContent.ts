/**
 * Helpers for the rich-text document format (ProseMirror/TipTap JSON).
 * Kept free of editor imports so services and tests can use them.
 */

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export const EMPTY_DOC: DocNode = { type: "doc", content: [] };

export function parseDoc(json: string | null | undefined): DocNode {
  if (!json) return EMPTY_DOC;
  try {
    const d = JSON.parse(json) as DocNode;
    return d && d.type === "doc" ? d : EMPTY_DOC;
  } catch {
    return EMPTY_DOC;
  }
}

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "listItem",
  "taskItem",
  "tableRow",
  "blockMath",
  "horizontalRule",
]);

/** Plain text of a document, one line per block; math is kept as its LaTeX source. */
export function docToText(doc: DocNode): string {
  const lines: string[] = [];
  let current = "";
  const walk = (n: DocNode) => {
    if (n.type === "text") current += n.text ?? "";
    else if (n.type === "inlineMath" || n.type === "blockMath") current += String(n.attrs?.latex ?? "");
    else if (n.type === "hardBreak") current += "\n";
    else if (n.type === "tableCell" || n.type === "tableHeader") {
      n.content?.forEach(walk);
      current += "\t";
      return;
    }
    n.content?.forEach(walk);
    if (BLOCK_TYPES.has(n.type)) {
      if (current.trim()) lines.push(current.trim());
      current = "";
    }
  };
  walk(doc);
  if (current.trim()) lines.push(current.trim());
  return lines.join("\n");
}

const heading = (level: number, text: string): DocNode => ({
  type: "heading",
  attrs: { level },
  content: text ? [{ type: "text", text }] : [],
});
const paragraph = (): DocNode => ({ type: "paragraph" });

export const LECTURE_TEMPLATE_SECTIONS = [
  "Main Concepts",
  "Important Definitions",
  "Formulas",
  "Examples",
  "Questions",
  "Things I Don't Understand",
  "Follow Up",
];

/** The default lecture template from the StudyOS spec, filled in for a specific lecture. */
export function lectureTemplateDoc(number: number | null, title: string): DocNode {
  const head = number != null ? `Lecture ${number} — ${title}` : title;
  return {
    type: "doc",
    content: [heading(1, head), ...LECTURE_TEMPLATE_SECTIONS.flatMap((s) => [heading(2, s), paragraph()])],
  };
}

/** A titled document with an empty paragraph under each section heading. */
export function sectionsDoc(title: string, sections: readonly string[]): DocNode {
  return { type: "doc", content: [heading(1, title), ...sections.flatMap((s) => [heading(2, s), paragraph()])] };
}

/**
 * Replaces `{{number}}`, `{{title}}`, `{{course}}` and `{{date}}` placeholders in a
 * custom template's text nodes.
 */
export function fillTemplate(doc: DocNode, values: Record<string, string>): DocNode {
  const fill = (n: DocNode): DocNode => ({
    ...n,
    ...(n.text != null ? { text: n.text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => values[k] ?? m) } : {}),
    ...(n.content ? { content: n.content.map(fill) } : {}),
  });
  return fill(doc);
}

/** First heading or line of a document, used to title untitled notes. */
export function deriveTitle(doc: DocNode, fallback = "Untitled note"): string {
  const first = docToText(doc).split("\n").find((l) => l.trim());
  return first ? first.trim().slice(0, 120) : fallback;
}
