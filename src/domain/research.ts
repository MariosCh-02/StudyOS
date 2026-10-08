/**
 * Research helpers with no database access: author names, citations (APA 7
 * and BibTeX), BibTeX parsing, Crossref mapping, DOI handling, project
 * progress and milestone extraction from guided-project lessons.
 */

export interface Author {
  family: string;
  given: string;
}

/** Bibliographic fields shared by papers, BibTeX entries and Crossref records. */
export interface CitationFields {
  title: string;
  /** "Family, Given" strings. */
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  abstract: string | null;
  entryType: string;
  citeKey: string | null;
}

// ------------------------------------------------------------------ authors

/** Splits "Family, Given" or "Given Family" (also "Given von Family"). */
export function parseAuthor(name: string): Author {
  const n = name.replace(/\s+/g, " ").trim();
  if (!n) return { family: "", given: "" };
  const comma = n.indexOf(",");
  if (comma >= 0) return { family: n.slice(0, comma).trim(), given: n.slice(comma + 1).trim() };
  const parts = n.split(" ");
  if (parts.length === 1) return { family: n, given: "" };
  // Lower-case particles (van, von, de, …) belong to the family name.
  let i = parts.length - 1;
  while (i > 1 && /^[a-z]/.test(parts[i - 1]!)) i--;
  return { family: parts.slice(i).join(" "), given: parts.slice(0, i).join(" ") };
}

/** Canonical stored form: "Family, Given". */
export const formatAuthor = (a: Author): string => (a.given ? `${a.family}, ${a.given}` : a.family);

/** Accepts one author per line or separated by ";" or " and ". */
export function parseAuthorList(text: string): string[] {
  return text
    .split(/\n|;|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => formatAuthor(parseAuthor(s)));
}

/** "Jean-Paul Sartre" → "J.-P."; "Ada" → "A." */
export function initials(given: string): string {
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split("-")
        .map((p) => (p.replace(/\./g, "") ? `${p.replace(/\./g, "")[0]!.toUpperCase()}.` : ""))
        .join("-"),
    )
    .join(" ");
}

// -------------------------------------------------------------------- DOI

/** Normalises a DOI or doi.org link to the bare lower-case DOI, or null if it isn't one. */
export function normaliseDoi(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input
    .trim()
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .trim();
  return /^10\.\d{4,9}\/\S+$/.test(s) ? s.toLowerCase() : null;
}

export const doiUrl = (doi: string): string => `https://doi.org/${doi}`;

// -------------------------------------------------------------- cite keys

const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const STOP_WORDS = new Set(["a", "an", "the", "on", "of", "in", "for", "to", "and", "with", "towards", "toward", "is", "are", "via", "from", "by", "at"]);

/** e.g. Vaswani, "Attention is all you need", 2017 → "vaswani2017attention". */
export function makeCiteKey(f: Pick<CitationFields, "authors" | "year" | "title">): string {
  const family = f.authors[0] ? parseAuthor(f.authors[0]).family : "anon";
  const word = ascii(f.title)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .find((w) => w.length > 1 && !STOP_WORDS.has(w));
  const base = `${ascii(family).toLowerCase().replace(/[^a-z0-9]/g, "") || "anon"}${f.year ?? ""}${word ?? ""}`;
  return base || "paper";
}

/** Adds a, b, c… until the key is not taken. */
export function uniqueCiteKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 0; i < 26 * 26; i++) {
    const suffix = i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(97 + Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26));
    if (!taken.has(base + suffix)) return base + suffix;
  }
  return `${base}-${Date.now()}`;
}

// ------------------------------------------------------------------- APA 7

function apaAuthors(names: string[]): string {
  const list = names.map((n) => {
    const a = parseAuthor(n);
    return a.given ? `${a.family}, ${initials(a.given)}` : a.family;
  });
  if (list.length === 0) return "";
  if (list.length === 1) return list[0]!;
  if (list.length <= 20) return `${list.slice(0, -1).join(", ")}, & ${list[list.length - 1]}`;
  // 21 or more: first 19, an ellipsis, then the last author.
  return `${list.slice(0, 19).join(", ")}, … ${list[list.length - 1]}`;
}

const endWithPeriod = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

/**
 * An APA 7 reference. Returned as Markdown so the venue can be italicised;
 * `plain` is the same text without emphasis for copying into other tools.
 */
export function formatApa(f: CitationFields): { markdown: string; plain: string } {
  const authors = apaAuthors(f.authors);
  const year = `(${f.year ?? "n.d."}).`;
  const title = endWithPeriod(f.title.trim());
  const link = f.doi ? doiUrl(f.doi) : f.url;
  const head = authors ? `${endWithPeriod(authors)} ${year} ${title}` : `${title} ${year}`;
  const venue = f.venue?.trim();
  const md = [head, venue ? `*${venue}*.` : null, link].filter(Boolean).join(" ");
  const plain = [head, venue ? `${venue}.` : null, link].filter(Boolean).join(" ");
  return { markdown: md, plain };
}

/** In-text citation, e.g. (Vaswani et al., 2017). */
export function inTextCitation(f: Pick<CitationFields, "authors" | "year">): string {
  const fam = f.authors.map((a) => parseAuthor(a).family);
  const who = fam.length === 0 ? "Anonymous" : fam.length === 1 ? fam[0] : fam.length === 2 ? `${fam[0]} & ${fam[1]}` : `${fam[0]} et al.`;
  return `(${who}, ${f.year ?? "n.d."})`;
}

// ----------------------------------------------------------------- BibTeX

const BIB_ESCAPES: [RegExp, string][] = [
  [/\\/g, "\\textbackslash{}"],
  [/([&%#_])/g, "\\$1"],
];
const escapeBib = (s: string) => BIB_ESCAPES.reduce((acc, [re, rep]) => acc.replace(re, rep), s.replace(/[{}]/g, ""));

/** Venue field name for a BibTeX entry type. */
const venueField = (type: string) => (type === "inproceedings" || type === "incollection" || type === "conference" ? "booktitle" : type === "book" ? "publisher" : type === "phdthesis" || type === "mastersthesis" ? "school" : type === "misc" || type === "online" ? "howpublished" : "journal");

export function toBibtex(f: CitationFields, key: string): string {
  const type = f.entryType || "article";
  const fields: [string, string | null][] = [
    // Double braces keep the title's capitalisation in most styles.
    ["title", `{${escapeBib(f.title.trim())}}`],
    ["author", f.authors.length ? escapeBib(f.authors.join(" and ")) : null],
    ["year", f.year != null ? String(f.year) : null],
    [venueField(type), f.venue ? escapeBib(f.venue) : null],
    ["doi", f.doi],
    ["url", f.url],
  ];
  const body = fields
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n");
  return `@${type}{${key},\n${body}\n}`;
}

export interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

const LATEX_ACCENTS: Record<string, Record<string, string>> = {
  '"': { a: "ä", o: "ö", u: "ü", e: "ë", i: "ï", A: "Ä", O: "Ö", U: "Ü" },
  "'": { a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý", c: "ć", n: "ń", s: "ś", z: "ź", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" },
  "`": { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È" },
  "^": { a: "â", e: "ê", i: "î", o: "ô", u: "û" },
  "~": { a: "ã", n: "ñ", o: "õ", N: "Ñ" },
  c: { c: "ç", C: "Ç", s: "ş" },
  v: { c: "č", s: "š", z: "ž", r: "ř", C: "Č", S: "Š", Z: "Ž" },
};
const LATEX_SYMBOLS: Record<string, string> = { ss: "ß", o: "ø", O: "Ø", aa: "å", AA: "Å", ae: "æ", l: "ł", L: "Ł", i: "ı" };

/** Turns common LaTeX escapes into Unicode and removes protective braces. */
export function latexToText(s: string): string {
  return s
    .replace(/\{?\\([`'^"~])\s*\{?([A-Za-z])\}?\}?/g, (_m, acc: string, ch: string) => LATEX_ACCENTS[acc]?.[ch] ?? ch)
    // \c and \v are letters, so they need a brace or space before the accented letter (not \cite, \vspace).
    .replace(/\{?\\([cv])(?:\{([A-Za-z])\}|\s+([A-Za-z])(?![A-Za-z]))\}?/g, (_m, acc: string, a?: string, b?: string) => LATEX_ACCENTS[acc]?.[(a ?? b)!] ?? (a ?? b)!)
    .replace(/\{?\\(ss|aa|AA|ae|o|O|l|L)\}?(?![A-Za-z])/g, (_m, sym: string) => LATEX_SYMBOLS[sym] ?? sym)
    .replace(/\\([&%#_$])/g, "$1")
    .replace(/\\textbackslash\{\}/g, "\\")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses BibTeX text into entries. Handles braced and quoted values, bare
 * numbers, nested braces, @comment / @preamble / @string blocks (skipped)
 * and junk between entries. Field names are lower-cased.
 */
export function parseBibtex(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  let i = 0;
  const n = text.length;
  const skipWs = () => {
    while (i < n && /\s/.test(text[i]!)) i++;
  };
  /** Reads a value delimited by `open`/`close` with nested braces; i is at the opener. */
  const readDelimited = (close: string): string => {
    const start = ++i;
    let depth = 0;
    for (; i < n; i++) {
      const c = text[i]!;
      if (c === "\\") i++;
      else if (c === "{") depth++;
      else if (c === "}" && depth > 0) depth--;
      else if (c === close && depth === 0) return text.slice(start, i++);
    }
    return text.slice(start);
  };

  while (i < n) {
    const at = text.indexOf("@", i);
    if (at < 0) break;
    i = at + 1;
    const typeMatch = /^[A-Za-z]+/.exec(text.slice(i));
    if (!typeMatch) continue;
    const type = typeMatch[0].toLowerCase();
    i += typeMatch[0].length;
    skipWs();
    const open = text[i];
    if (open !== "{" && open !== "(") continue;
    const close = open === "{" ? "}" : ")";
    if (type === "comment" || type === "preamble" || type === "string") {
      readDelimited(close);
      continue;
    }
    i++;
    skipWs();
    const keyEnd = text.slice(i).search(/[,\s}]/);
    if (keyEnd < 0) break;
    const key = text.slice(i, i + keyEnd).trim();
    i += keyEnd;
    const fields: Record<string, string> = {};
    while (i < n) {
      skipWs();
      if (text[i] === ",") {
        i++;
        continue;
      }
      // An "@" where a field name should be means this entry was never closed: start the next one.
      if (text[i] === "@") break;
      if (text[i] === close) {
        i++;
        break;
      }
      const nameMatch = /^[A-Za-z][\w-]*/.exec(text.slice(i));
      if (!nameMatch) {
        i++;
        continue;
      }
      const name = nameMatch[0].toLowerCase();
      i += nameMatch[0].length;
      skipWs();
      if (text[i] !== "=") continue;
      i++;
      skipWs();
      let value = "";
      // value parts joined with #
      for (;;) {
        skipWs();
        const c = text[i];
        if (c === "{") value += readDelimited("}");
        else if (c === '"') value += readDelimited('"');
        else {
          const bare = /^[^,}\s#)]+/.exec(text.slice(i));
          if (bare) {
            value += bare[0];
            i += bare[0].length;
          }
        }
        skipWs();
        if (text[i] === "#") {
          i++;
          continue;
        }
        break;
      }
      fields[name] = value;
    }
    if (key || Object.keys(fields).length) entries.push({ type, key, fields });
  }
  return entries;
}

/** Maps a parsed BibTeX entry to paper fields. */
export function bibEntryToFields(e: BibEntry): CitationFields {
  const f = e.fields;
  const text = (k: string) => (f[k] != null ? latexToText(f[k]!) : "");
  const year = parseInt(text("year"), 10);
  const venue = text("journal") || text("booktitle") || text("publisher") || text("school") || text("howpublished") || text("institution") || text("organization");
  const doi = normaliseDoi(text("doi"));
  return {
    title: text("title") || e.key || "Untitled",
    authors: f.author ? latexToText(f.author.replace(/\s+and\s+/gi, "\u0000")).split("\u0000").map((a) => formatAuthor(parseAuthor(a))).filter(Boolean) : [],
    year: Number.isFinite(year) ? year : null,
    venue: venue || null,
    doi,
    url: text("url") || null,
    abstract: text("abstract") || null,
    entryType: e.type,
    citeKey: e.key || null,
  };
}

// ---------------------------------------------------------------- Crossref

/** The parts of a Crossref /works/{doi} "message" that StudyOS uses. */
export interface CrossrefWork {
  title?: string[];
  author?: { family?: string; given?: string; name?: string }[];
  issued?: { "date-parts"?: (number | null)[][] };
  published?: { "date-parts"?: (number | null)[][] };
  "container-title"?: string[];
  publisher?: string;
  DOI?: string;
  URL?: string;
  abstract?: string;
  type?: string;
}

const CROSSREF_TYPES: Record<string, string> = {
  "journal-article": "article",
  "proceedings-article": "inproceedings",
  "book-chapter": "incollection",
  book: "book",
  "posted-content": "misc",
  dissertation: "phdthesis",
  report: "techreport",
};

export function crossrefToFields(w: CrossrefWork): CitationFields {
  const parts = w.issued?.["date-parts"]?.[0] ?? w.published?.["date-parts"]?.[0];
  const year = parts?.[0] ?? null;
  // Abstracts arrive as JATS XML; keep the text.
  const abstract = w.abstract ? w.abstract.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null;
  return {
    title: (w.title?.[0] ?? "").replace(/\s+/g, " ").trim() || "Untitled",
    authors: (w.author ?? []).map((a) => (a.family ? formatAuthor({ family: a.family, given: a.given ?? "" }) : (a.name ?? ""))).filter(Boolean),
    year: typeof year === "number" ? year : null,
    venue: w["container-title"]?.[0] ?? w.publisher ?? null,
    doi: normaliseDoi(w.DOI),
    url: w.URL ?? null,
    abstract: abstract || null,
    entryType: CROSSREF_TYPES[w.type ?? ""] ?? "article",
    citeKey: null,
  };
}

// --------------------------------------------------------------- projects

export interface Progress {
  done: number;
  total: number;
  /** 0–1; null when there is nothing to measure. */
  ratio: number | null;
}

/** Progress counts milestones and tasks together (each counts once). */
export function projectProgress(milestones: { done: boolean }[], tasks: { done: boolean }[]): Progress {
  const all = [...milestones, ...tasks];
  const done = all.filter((x) => x.done).length;
  return { done, total: all.length, ratio: all.length ? done / all.length : null };
}

/**
 * Milestone titles from a guided-project lesson: the numbered list under
 * "## Milestones". Uses the bold lead-in ("**Data preparation.**") when
 * present, otherwise the first sentence.
 */
export function parseMilestones(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{2,3}\s+milestones\s*$/i.test(l.trim()));
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,3}\s/.test(line)) break;
    const m = /^\s{0,3}\d+[.)]\s+(.*)$/.exec(line);
    if (!m) continue;
    const item = m[1]!.trim();
    const bold = /^\*\*(.+?)\*\*/.exec(item);
    const raw = bold ? bold[1]! : (item.split(/(?<=[.!?])\s/)[0] ?? item);
    const title = raw.replace(/[`*_]/g, "").replace(/[.:]\s*$/, "").trim();
    if (title) out.push(title.length > 150 ? `${title.slice(0, 147)}…` : title);
  }
  return out;
}

/** Spreads `count` due dates evenly from start (exclusive) to end (inclusive), as YYYY-MM-DD. */
export function spreadDates(start: string, end: string, count: number): string[] {
  const s = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10));
  const e = Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10));
  if (!(e >= s) || count <= 0) return [];
  const days = (e - s) / 86_400_000;
  return Array.from({ length: count }, (_, k) => {
    const d = new Date(s + Math.round(((k + 1) * days) / count) * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
}
