/**
 * Research papers: a reading library with summaries, reading notes, PDFs,
 * citations (APA / BibTeX) and project literature lists.
 */
import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import { assertValid, blankToNull, requireText } from "@/domain/validation";
import {
  bibEntryToFields,
  crossrefToFields,
  makeCiteKey,
  normaliseDoi,
  parseBibtex,
  toBibtex,
  uniqueCiteKey,
  type CitationFields,
  type CrossrefWork,
} from "@/domain/research";
import { sectionsDoc } from "@/domain/noteContent";
import { createNote, getNote } from "./notes";
import type { Note } from "@/domain/types";

export const PAPER_STATUSES = ["to_read", "reading", "read"] as const;
export type PaperStatus = (typeof PAPER_STATUSES)[number];
export const PAPER_STATUS_LABELS: Record<PaperStatus, string> = { to_read: "To read", reading: "Reading", read: "Read" };

export const ENTRY_TYPES = ["article", "inproceedings", "book", "incollection", "phdthesis", "mastersthesis", "techreport", "misc"] as const;
export const ENTRY_TYPE_LABELS: Record<string, string> = {
  article: "Journal article",
  inproceedings: "Conference paper",
  book: "Book",
  incollection: "Book chapter",
  phdthesis: "PhD thesis",
  mastersthesis: "Master's thesis",
  techreport: "Technical report",
  misc: "Preprint / other",
};

export interface Paper extends CitationFields {
  id: string;
  summary: string | null;
  status: PaperStatus;
  rating: number | null;
  createdAt: string;
  updatedAt: string;
}

export type PaperInput = Omit<CitationFields, "citeKey"> & { citeKey: string | null; summary: string | null; status: PaperStatus; rating: number | null };

interface Row {
  id: string;
  title: string;
  authors: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  abstract: string | null;
  summary: string | null;
  entry_type: string;
  cite_key: string | null;
  status: PaperStatus;
  rating: number | null;
  created_at: string;
  updated_at: string;
}

function parseAuthors(text: string): string[] {
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const map = (r: Row): Paper => ({
  id: r.id,
  title: r.title,
  authors: parseAuthors(r.authors),
  year: r.year,
  venue: r.venue,
  doi: r.doi,
  url: r.url,
  abstract: r.abstract,
  summary: r.summary,
  entryType: r.entry_type,
  citeKey: r.cite_key,
  status: r.status,
  rating: r.rating,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const THIS_YEAR = new Date().getFullYear();

function validate(input: PaperInput): PaperInput {
  const doi = input.doi?.trim() ? normaliseDoi(input.doi) : null;
  assertValid({
    title: requireText(input.title, "Title", 500),
    year: input.year != null && !(Number.isInteger(input.year) && input.year >= 1000 && input.year <= THIS_YEAR + 2) ? "Enter a four-digit year." : undefined,
    doi: input.doi?.trim() && !doi ? "That doesn't look like a DOI (it starts with 10.)." : undefined,
    url: input.url?.trim() && !/^https?:\/\/\S+$/i.test(input.url.trim()) ? "Use a web address (https://…)." : undefined,
    status: (PAPER_STATUSES as readonly string[]).includes(input.status) ? undefined : "Choose a reading status.",
    rating: input.rating != null && !(Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5) ? "Rating is 1 to 5." : undefined,
    citeKey: input.citeKey?.trim() && !/^[A-Za-z0-9_:.-]+$/.test(input.citeKey.trim()) ? "Use letters, digits and _ : . - only." : undefined,
  });
  return {
    ...input,
    title: input.title.trim(),
    authors: input.authors.map((a) => a.trim()).filter(Boolean),
    venue: blankToNull(input.venue),
    doi,
    url: blankToNull(input.url),
    abstract: blankToNull(input.abstract),
    summary: blankToNull(input.summary),
    entryType: input.entryType || "article",
    citeKey: blankToNull(input.citeKey),
  };
}

export interface PaperFilter {
  status?: PaperStatus;
  projectId?: string;
  search?: string;
}

export async function listPapers(filter: PaperFilter = {}): Promise<Paper[]> {
  const db = await getDb();
  const params: string[] = [];
  let sql = "SELECT p.* FROM papers p WHERE p.deleted_at IS NULL";
  if (filter.status) {
    params.push(filter.status);
    sql += ` AND p.status = $${params.length}`;
  }
  if (filter.projectId) {
    params.push(filter.projectId);
    sql += ` AND EXISTS (SELECT 1 FROM project_papers pp WHERE pp.paper_id = p.id AND pp.project_id = $${params.length} AND pp.deleted_at IS NULL)`;
  }
  const rows = await db.select<Row>(`${sql} ORDER BY p.created_at DESC`, params);
  const term = filter.search?.trim().toLowerCase();
  return rows.map(map).filter((p) => !term || [p.title, ...p.authors, p.venue ?? "", p.doi ?? "", String(p.year ?? "")].some((s) => s.toLowerCase().includes(term)));
}

export async function getPaper(id: string): Promise<Paper | null> {
  const db = await getDb();
  const rows = await db.select<Row>("SELECT * FROM papers WHERE id = $1 AND deleted_at IS NULL", [id]);
  return rows[0] ? map(rows[0]) : null;
}

async function takenKeys(exceptId?: string): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.select<{ cite_key: string }>("SELECT cite_key FROM papers WHERE deleted_at IS NULL AND cite_key IS NOT NULL AND id != $1", [exceptId ?? ""]);
  return new Set(rows.map((r) => r.cite_key));
}

/** An existing paper with the same DOI, or failing that the same title (case-insensitive). */
export async function findDuplicate(f: Pick<CitationFields, "doi" | "title">, exceptId?: string): Promise<Paper | null> {
  const db = await getDb();
  const doi = normaliseDoi(f.doi);
  const rows = await db.select<Row>(
    `SELECT * FROM papers WHERE deleted_at IS NULL AND id != $3
       AND ((doi IS NOT NULL AND doi = $1) OR lower(trim(title)) = $2) LIMIT 1`,
    [doi ?? "", f.title.trim().toLowerCase(), exceptId ?? ""],
  );
  return rows[0] ? map(rows[0]) : null;
}

export async function createPaper(input: PaperInput): Promise<Paper> {
  const v = validate(input);
  const dup = await findDuplicate(v);
  if (dup) throw new Error(`"${dup.title}" is already in your library.`);
  const taken = await takenKeys();
  if (v.citeKey && taken.has(v.citeKey)) throw new Error(`Citation key "${v.citeKey}" is already used.`);
  const key = v.citeKey ?? uniqueCiteKey(makeCiteKey(v), taken);
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO papers (id, title, authors, year, venue, doi, url, abstract, summary, entry_type, cite_key, status, rating, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
    [id, v.title, JSON.stringify(v.authors), v.year, v.venue, v.doi, v.url, v.abstract, v.summary, v.entryType, key, v.status, v.rating, now],
  );
  return (await getPaper(id))!;
}

export async function updatePaper(id: string, input: PaperInput): Promise<Paper> {
  const v = validate(input);
  const dup = await findDuplicate(v, id);
  if (dup) throw new Error(`"${dup.title}" is already in your library.`);
  const taken = await takenKeys(id);
  if (v.citeKey && taken.has(v.citeKey)) throw new Error(`Citation key "${v.citeKey}" is already used.`);
  const key = v.citeKey ?? uniqueCiteKey(makeCiteKey(v), taken);
  const db = await getDb();
  await db.execute(
    `UPDATE papers SET title = $2, authors = $3, year = $4, venue = $5, doi = $6, url = $7, abstract = $8, summary = $9, entry_type = $10,
       cite_key = $11, status = $12, rating = $13, updated_at = $14 WHERE id = $1 AND deleted_at IS NULL`,
    [id, v.title, JSON.stringify(v.authors), v.year, v.venue, v.doi, v.url, v.abstract, v.summary, v.entryType, key, v.status, v.rating, nowIso()],
  );
  const p = await getPaper(id);
  if (!p) throw new Error("Paper not found.");
  return p;
}

export async function patchPaper(id: string, patch: Partial<Pick<Paper, "status" | "rating" | "summary">>): Promise<void> {
  const p = await getPaper(id);
  if (!p) throw new Error("Paper not found.");
  await updatePaper(id, { ...p, ...patch });
}

/** Deletes a paper with its PDF/files and reading notes, and removes it from project lists. */
export async function deletePaper(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE project_papers SET deleted_at = $2, updated_at = $2 WHERE paper_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE attachments SET deleted_at = $2, updated_at = $2 WHERE owner_type = 'paper' AND owner_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute(
    "UPDATE attachments SET deleted_at = $2, updated_at = $2 WHERE owner_type = 'note' AND deleted_at IS NULL AND owner_id IN (SELECT id FROM notes WHERE paper_id = $1 AND deleted_at IS NULL)",
    [id, now],
  );
  await db.execute("UPDATE notes SET deleted_at = $2, updated_at = $2 WHERE paper_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE knowledge_links SET deleted_at = $2, updated_at = $2 WHERE target_type = 'paper' AND target_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE papers SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

// --------------------------------------------------------- project papers

export async function addPaperToProject(projectId: string, paperId: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute(
    `INSERT INTO project_papers (id, project_id, paper_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at`,
    [`${projectId}|${paperId}`, projectId, paperId, now],
  );
}

export async function removePaperFromProject(projectId: string, paperId: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE project_papers SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [`${projectId}|${paperId}`, now]);
}

/** Projects a paper is used in. */
export async function projectsForPaper(paperId: string): Promise<{ id: string; title: string }[]> {
  const db = await getDb();
  return db.select<{ id: string; title: string }>(
    `SELECT p.id, p.title FROM project_papers pp JOIN projects p ON p.id = pp.project_id AND p.deleted_at IS NULL
     WHERE pp.paper_id = $1 AND pp.deleted_at IS NULL ORDER BY p.title COLLATE NOCASE`,
    [paperId],
  );
}

// ------------------------------------------------------------- reading notes

/** The paper's reading note, created on first use with a reading template. */
export async function getOrCreatePaperNote(paperId: string): Promise<Note> {
  const db = await getDb();
  const rows = await db.select<{ id: string }>("SELECT id FROM notes WHERE paper_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1", [paperId]);
  if (rows[0]) return (await getNote(rows[0].id))!;
  const paper = await getPaper(paperId);
  if (!paper) throw new Error("Paper not found.");
  const title = `Reading notes — ${paper.title}`.slice(0, 200);
  return createNote({
    paperId,
    title,
    doc: sectionsDoc(title, ["Problem", "Method", "Key results", "Strengths", "Weaknesses and open questions", "How it relates to my work"]),
  });
}

// ---------------------------------------------------------------- BibTeX

export function paperToBibtex(p: Paper): string {
  return toBibtex(p, p.citeKey ?? makeCiteKey(p));
}

export const papersToBibtex = (papers: Paper[]): string => papers.map(paperToBibtex).join("\n\n") + (papers.length ? "\n" : "");

export interface ImportResult {
  created: Paper[];
  /** Entries already in the library (matched by DOI or title). */
  duplicates: { title: string; existingId: string }[];
  errors: string[];
}

/**
 * Imports BibTeX entries as papers. Existing papers (same DOI or title) are
 * not duplicated but are still added to the project when one is given.
 */
export async function importBibtex(text: string, projectId?: string): Promise<ImportResult> {
  const entries = parseBibtex(text);
  const result: ImportResult = { created: [], duplicates: [], errors: [] };
  if (!entries.length) {
    result.errors.push("No BibTeX entries were found (they start with @article{…, @inproceedings{… and so on).");
    return result;
  }
  const taken = await takenKeys();
  for (const e of entries) {
    const f = bibEntryToFields(e);
    try {
      const dup = await findDuplicate(f);
      if (dup) {
        result.duplicates.push({ title: dup.title, existingId: dup.id });
        if (projectId) await addPaperToProject(projectId, dup.id);
        continue;
      }
      const citeKey = f.citeKey && /^[A-Za-z0-9_:.-]+$/.test(f.citeKey) && !taken.has(f.citeKey) ? f.citeKey : null;
      const paper = await createPaper({ ...f, citeKey, summary: null, status: "to_read", rating: null });
      if (paper.citeKey) taken.add(paper.citeKey);
      if (projectId) await addPaperToProject(projectId, paper.id);
      result.created.push(paper);
    } catch (err) {
      result.errors.push(`${f.title}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}

// --------------------------------------------------------------- DOI lookup

/**
 * Looks a DOI up in the public Crossref API (only the DOI is sent). Returns
 * the fields to pre-fill the paper form with.
 */
export async function lookupDoi(input: string, fetchFn: typeof fetch = fetch): Promise<CitationFields> {
  const doi = normaliseDoi(input);
  if (!doi) throw new Error("Enter a DOI such as 10.1038/nature14539 or a doi.org link.");
  let res: Response;
  try {
    res = await fetchFn(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { Accept: "application/json" } });
  } catch {
    throw new Error("Couldn't reach Crossref. Check your internet connection, or fill the details in by hand.");
  }
  if (res.status === 404) throw new Error("Crossref doesn't know this DOI. Check it, or fill the details in by hand.");
  if (!res.ok) throw new Error(`Crossref lookup failed (${res.status}). Try again later or fill the details in by hand.`);
  const json = (await res.json()) as { message?: CrossrefWork };
  if (!json.message) throw new Error("Crossref returned an unexpected response.");
  return crossrefToFields(json.message);
}
