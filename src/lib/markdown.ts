/**
 * Markdown + LaTeX rendering for lessons, questions, flashcards and formulas.
 *
 * - Raw HTML is disabled, so content from curriculum packs can't inject markup.
 * - $…$ and $$…$$ are rendered with KaTeX (trust disabled); math inside code
 *   spans and fenced blocks is left alone.
 * - Code blocks are highlighted with highlight.js (the same languages as notes).
 */
import MarkdownIt, { type RendererRule } from "markdown-it";
import katex from "katex";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";

const LANGS = { bash, cpp, csharp, java, javascript, json, python, rust, sql, typescript, yaml };
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang);

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(code, lang) {
    const language = lang && hljs.getLanguage(lang) ? lang : null;
    const body = language ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escape(code);
    return `<pre class="md-code"><code class="hljs${language ? ` language-${language}` : ""}">${body}</code></pre>`;
  },
});

// External links open in the browser via the global link guard; mark them.
const fallbackLinkOpen: RendererRule = (tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options);
const defaultLinkOpen = md.renderer.rules.link_open ?? fallbackLinkOpen;
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx]!.attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderLatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: false, trust: false, strict: "ignore" });
  } catch {
    return `<code>${escape(latex)}</code>`;
  }
}

/** Every LaTeX expression in a Markdown source (outside code), as the renderer sees it. */
export function mathSegments(source: string): { tex: string; display: boolean }[] {
  const out: { tex: string; display: boolean }[] = [];
  source.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).forEach((part, i) => {
    if (i % 2 === 1) return;
    const rest = part.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => {
      out.push({ tex: tex.trim(), display: true });
      return " ";
    });
    rest.replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, _pre: string, tex: string) => {
      out.push({ tex, display: false });
      return "";
    });
  });
  return out;
}

/**
 * Replaces math with placeholder tokens (outside code), renders Markdown,
 * then swaps the rendered KaTeX back in.
 */
export function renderMarkdown(source: string, opts: { inline?: boolean } = {}): string {
  const math: { html: string; tex: string; display: boolean }[] = [];
  // Private-use character markers survive markdown-it untouched (NUL does not).
  const stash = (tex: string, display: boolean) => `\uE000M${math.push({ html: renderLatex(tex, display), tex, display }) - 1}`;

  // Split out fenced code blocks and inline code so their `$` stay literal.
  // Marker characters typed by the user are removed so they can't refer to other formulas.
  const parts = source.replace(/\uE000/g, "").split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  const prepared = parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // code
      return part
        .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => `\n\n${stash(tex.trim(), true)}\n\n`)
        .replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, pre: string, tex: string) => pre + stash(tex, false))
        .replace(/\\\$/g, "$");
    })
    .join("");

  const html = opts.inline ? md.renderInline(prepared) : md.render(prepared);
  const marker = /\uE000M(\d+)/g;
  return (
    html
      // Maths that ended up inside a tag (image alt text, link title) goes back as escaped source text.
      .replace(/<[^>]*\uE000M\d+[^>]*>/g, (tag) =>
        tag.replace(marker, (_, i: string) => {
          const m = math[Number(i)];
          return m ? escapeAttr(m.display ? `$$${m.tex}$$` : `$${m.tex}$`) : "";
        }),
      )
      // Block math rendered inside its own paragraph: unwrap it.
      .replace(/<p>\s*\uE000M(\d+)\s*<\/p>/g, (_, i: string) => math[Number(i)]?.html ?? "")
      .replace(marker, (_, i: string) => math[Number(i)]?.html ?? "")
  );
}

const escapeAttr = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
