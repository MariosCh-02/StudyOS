/**
 * Converts between the note editor's document format and Markdown, so notes
 * can be sent to an AI model with their structure intact and Markdown answers
 * can be inserted back as real headings, lists, code and maths.
 */
import type { DocNode } from "./noteContent";

// --------------------------------------------------------- doc → Markdown

function inline(nodes: DocNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "inlineMath") return `$${String(n.attrs?.latex ?? "")}$`;
      if (n.type === "hardBreak") return "\n";
      if (n.type === "image") return n.attrs?.alt ? `[image: ${String(n.attrs.alt)}]` : "[image]";
      if (n.type !== "text") return inline(n.content);
      let t = n.text ?? "";
      const marks = new Set((n.marks ?? []).map((m) => m.type));
      if (marks.has("code")) t = `\`${t}\``;
      if (marks.has("bold")) t = `**${t}**`;
      if (marks.has("italic")) t = `*${t}*`;
      if (marks.has("strike")) t = `~~${t}~~`;
      const link = n.marks?.find((m) => m.type === "link");
      if (link?.attrs?.href) t = `[${t}](${String(link.attrs.href)})`;
      return t;
    })
    .join("");
}

function block(n: DocNode, indent = ""): string[] {
  switch (n.type) {
    case "heading":
      return [`${"#".repeat(Number(n.attrs?.level ?? 1))} ${inline(n.content)}`];
    case "paragraph": {
      const t = inline(n.content);
      return t.trim() ? [indent + t.replace(/\n/g, `\n${indent}`)] : [];
    }
    case "blockquote":
      return (n.content ?? []).flatMap((c) => block(c)).map((l) => `> ${l}`);
    case "codeBlock": {
      const code = (n.content ?? []).map((c) => c.text ?? "").join("");
      return [`${indent}\`\`\`${String(n.attrs?.language ?? "")}`, ...code.split("\n").map((l) => indent + l), `${indent}\`\`\``];
    }
    case "blockMath":
      return [`${indent}$$${String(n.attrs?.latex ?? "")}$$`];
    case "horizontalRule":
      return ["---"];
    case "bulletList":
    case "orderedList":
    case "taskList":
      return (n.content ?? []).flatMap((item, i) => {
        const marker = n.type === "orderedList" ? `${i + 1}.` : n.type === "taskList" ? `- [${item.attrs?.checked ? "x" : " "}]` : "-";
        const [first, ...rest] = (item.content ?? []).flatMap((c) => block(c, `${indent}  `));
        return first != null ? [`${indent}${marker} ${first.trimStart()}`, ...rest] : [];
      });
    case "image":
      return [`${indent}[image: ${String(n.attrs?.alt ?? "image")}]`];
    case "table": {
      const rows = (n.content ?? []).map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).map((p) => inline(p.content)).join(" ").replace(/\|/g, "\\|").replace(/\n/g, " ")));
      if (!rows.length) return [];
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      return [line(rows[0]!), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)];
    }
    default:
      return (n.content ?? []).flatMap((c) => block(c, indent));
  }
}

/** Markdown for a note document (or any fragment of one). */
export function docToMarkdown(doc: DocNode): string {
  const parts = (doc.type === "doc" ? (doc.content ?? []) : [doc]).map((n) => block(n).join("\n")).filter((s) => s.trim());
  return parts.join("\n\n");
}

// --------------------------------------------------------- Markdown → doc

const text = (t: string, marks?: DocNode["marks"]): DocNode => (marks?.length ? { type: "text", text: t, marks } : { type: "text", text: t });

/** Inline Markdown: **bold**, *italic*, `code`, $math$ and [links](https://…). */
export function parseInline(s: string): DocNode[] {
  const out: DocNode[] = [];
  const re = /(\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|`([^`]+)`|(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)|\[([^\]\n]{1,500})\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push(text(s.slice(last, m.index)));
    if (m[2] ?? m[3]) out.push(...parseInline(m[2] ?? m[3]!).map((n) => (n.type === "text" ? { ...n, marks: [...(n.marks ?? []), { type: "bold" }] } : n)));
    else if (m[4] ?? m[5]) out.push(...parseInline(m[4] ?? m[5]!).map((n) => (n.type === "text" ? { ...n, marks: [...(n.marks ?? []), { type: "italic" }] } : n)));
    else if (m[6] != null) out.push(text(m[6], [{ type: "code" }]));
    else if (m[7] != null) out.push({ type: "inlineMath", attrs: { latex: m[7].trim() } });
    else if (m[8] != null) out.push(text(m[8], [{ type: "link", attrs: { href: m[9] } }]));
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push(text(s.slice(last)));
  return out.filter((n) => n.type !== "text" || n.text);
}

const paragraph = (s: string): DocNode => {
  const content = parseInline(s);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

/** Block Markdown → editor nodes: headings, lists, task lists, quotes, code, $$maths$$, rules, paragraphs. */
export function markdownToNodes(md: string, depth = 0): DocNode[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const nodes: DocNode[] = [];
  let i = 0;
  let para: string[] = [];
  const flush = () => {
    if (para.length) nodes.push(paragraph(para.join(" ").trim()));
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    let m: RegExpExecArray | null;
    if (!trimmed) {
      flush();
      i++;
    } else if ((m = /^```\s*([\w+-]*)\s*$/.exec(trimmed))) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!.trim())) body.push(lines[i++]!);
      i++;
      const code = body.join("\n");
      nodes.push({ type: "codeBlock", attrs: { language: m[1] || null }, content: code ? [text(code)] : undefined });
    } else if (trimmed.startsWith("$$")) {
      flush();
      let latex = trimmed.slice(2);
      if (latex.endsWith("$$") && latex.length >= 2) latex = latex.slice(0, -2);
      else {
        const body = [latex];
        i++;
        while (i < lines.length && !lines[i]!.trim().endsWith("$$")) body.push(lines[i++]!);
        if (i < lines.length) body.push(lines[i]!.trim().slice(0, -2));
        latex = body.join("\n");
      }
      i++;
      nodes.push({ type: "blockMath", attrs: { latex: latex.trim() } });
    } else if ((m = /^(#{1,6})\s+(.*)$/.exec(trimmed))) {
      flush();
      const level = Math.min(m[1]!.length, 3);
      const content = parseInline(m[2]!.replace(/\s+#+$/, ""));
      nodes.push({ type: "heading", attrs: { level }, ...(content.length ? { content } : {}) });
      i++;
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      nodes.push({ type: "horizontalRule" });
      i++;
    } else if (trimmed.startsWith(">")) {
      flush();
      const body: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) body.push(lines[i++]!.trim().replace(/^>\s?/, ""));
      // Nesting is capped so a pathological reply can't overflow the stack.
      nodes.push({ type: "blockquote", content: depth < 20 ? markdownToNodes(body.join("\n"), depth + 1) : [paragraph(body.join(" "))] });
    } else if (/^([-*+]|\d+[.)])\s+/.test(trimmed)) {
      flush();
      const ordered = /^\d/.test(trimmed);
      const task = /^[-*+]\s+\[[ xX]\]\s/.test(trimmed);
      const items: DocNode[] = [];
      while (i < lines.length) {
        const t = lines[i]!.trim();
        const im = /^([-*+]|\d+[.)])\s+(.*)$/.exec(t);
        if (im && /^\d/.test(t) === ordered) {
          let body = im[2]!;
          let checked = false;
          if (task) {
            const tm = /^\[([ xX])\]\s*(.*)$/.exec(body);
            checked = tm?.[1]?.toLowerCase() === "x";
            body = tm?.[2] ?? body;
          }
          items.push(task ? { type: "taskItem", attrs: { checked }, content: [paragraph(body)] } : { type: "listItem", content: [paragraph(body)] });
          i++;
        } else if (t && !im && items.length && /^\s+/.test(lines[i]!)) {
          // continuation line of the previous item
          const last = items[items.length - 1]!;
          const p = last.content![last.content!.length - 1]!;
          p.content = [...(p.content ?? []), text(" "), ...parseInline(t)];
          i++;
        } else break;
      }
      nodes.push({ type: task ? "taskList" : ordered ? "orderedList" : "bulletList", content: items });
    } else {
      para.push(trimmed);
      i++;
    }
  }
  flush();
  return nodes;
}
