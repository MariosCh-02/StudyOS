import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import type { DbDriver } from "../src/lib/db/driver";
import {
  bibEntryToFields,
  crossrefToFields,
  formatApa,
  inTextCitation,
  initials,
  latexToText,
  makeCiteKey,
  normaliseDoi,
  parseAuthor,
  parseAuthorList,
  parseBibtex,
  parseMilestones,
  projectProgress,
  spreadDates,
  toBibtex,
  uniqueCiteKey,
  type CitationFields,
} from "../src/domain/research";
import { createTrack, createSubject, createLesson } from "../src/services/learning";
import {
  addMilestone,
  createProject,
  createProjectNote,
  deleteProject,
  getOrCreateSectionNote,
  getProject,
  listMilestones,
  listProjectNotes,
  listProjects,
  moveMilestone,
  setMilestoneDone,
  startProjectFromLesson,
  updateProject,
  type ProjectInput,
} from "../src/services/projects";
import {
  addPaperToProject,
  createPaper,
  deletePaper,
  getOrCreatePaperNote,
  importBibtex,
  listPapers,
  lookupDoi,
  papersToBibtex,
  projectsForPaper,
  removePaperFromProject,
  type PaperInput,
} from "../src/services/papers";
import { createTask, listTasks, updateTask } from "../src/services/tracking";
import { getCalendarItems } from "../src/services/calendar";
import { search } from "../src/services/search";
import { createEntry, linkEntry, linkedItems } from "../src/services/knowledge";
import { addAttachment, listAllAttachments } from "../src/services/attachments";
import { getNote } from "../src/services/notes";
import { SYNC_TABLES } from "../src/sync/engine";

let db: DbDriver;

beforeEach(async () => {
  db = await createTestDb();
});

const project = (over: Partial<ProjectInput> = {}): ProjectInput => ({
  title: "Thesis: robust optimisation",
  kind: "thesis",
  status: "active",
  description: null,
  researchQuestion: "Does sharpness-aware minimisation improve robustness?",
  courseId: null,
  startDate: "2026-10-01",
  dueDate: "2027-06-30",
  members: [],
  links: [],
  ...over,
});

const paper = (over: Partial<PaperInput> = {}): PaperInput => ({
  title: "Attention Is All You Need",
  authors: ["Vaswani, Ashish", "Shazeer, Noam", "Parmar, Niki"],
  year: 2017,
  venue: "Advances in Neural Information Processing Systems",
  doi: null,
  url: null,
  abstract: null,
  entryType: "inproceedings",
  citeKey: null,
  summary: null,
  status: "to_read",
  rating: null,
  ...over,
});

describe("authors and citations", () => {
  it("parses author names in both orders, with particles", () => {
    expect(parseAuthor("Vaswani, Ashish")).toEqual({ family: "Vaswani", given: "Ashish" });
    expect(parseAuthor("Geoffrey E. Hinton")).toEqual({ family: "Hinton", given: "Geoffrey E." });
    expect(parseAuthor("Ludwig van Beethoven")).toEqual({ family: "van Beethoven", given: "Ludwig" });
    expect(parseAuthorList("Yann LeCun; Bengio, Yoshua\nGeoffrey Hinton")).toEqual(["LeCun, Yann", "Bengio, Yoshua", "Hinton, Geoffrey"]);
    expect(initials("Jean-Paul")).toBe("J.-P.");
    expect(initials("Geoffrey E.")).toBe("G. E.");
  });

  it("normalises DOIs and rejects non-DOIs", () => {
    expect(normaliseDoi("https://doi.org/10.1038/NATURE14539")).toBe("10.1038/nature14539");
    expect(normaliseDoi("doi: 10.48550/arXiv.1706.03762")).toBe("10.48550/arxiv.1706.03762");
    expect(normaliseDoi("not a doi")).toBeNull();
    expect(normaliseDoi("")).toBeNull();
  });

  it("formats APA 7 references and in-text citations", () => {
    const f: CitationFields = { ...paper(), doi: "10.48550/arxiv.1706.03762", citeKey: null };
    const apa = formatApa(f);
    expect(apa.plain).toBe(
      "Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention Is All You Need. Advances in Neural Information Processing Systems. https://doi.org/10.48550/arxiv.1706.03762",
    );
    expect(apa.markdown).toContain("*Advances in Neural Information Processing Systems*.");
    expect(formatApa({ ...f, authors: ["LeCun, Yann"], year: null, venue: null, doi: null, url: null }).plain).toBe("LeCun, Y. (n.d.). Attention Is All You Need.");
    expect(inTextCitation(f)).toBe("(Vaswani et al., 2017)");
    expect(inTextCitation({ authors: ["Goodfellow, Ian", "Bengio, Yoshua"], year: 2016 })).toBe("(Goodfellow & Bengio, 2016)");
    // 21+ authors: first 19, ellipsis, last
    const many = Array.from({ length: 22 }, (_, i) => `Author${i + 1}, A`);
    const plain = formatApa({ ...f, authors: many }).plain;
    expect(plain).toContain("Author19, A., … Author22, A.");
    expect(plain).not.toContain("Author20");
  });

  it("makes stable, unique citation keys", () => {
    expect(makeCiteKey({ authors: ["Vaswani, Ashish"], year: 2017, title: "Attention is all you need" })).toBe("vaswani2017attention");
    expect(makeCiteKey({ authors: ["Gödel, Kurt"], year: 1931, title: "On formally undecidable propositions" })).toBe("godel1931formally");
    expect(makeCiteKey({ authors: [], year: null, title: "The" })).toBe("anon");
    expect(uniqueCiteKey("x2020", new Set(["x2020", "x2020a"]))).toBe("x2020b");
  });
});

describe("BibTeX", () => {
  const BIB = `
% exported from a reference manager
@string{nips = "NeurIPS"}
@InProceedings{vaswani2017,
  title     = {Attention Is {All} You Need},
  author    = {Ashish Vaswani and Shazeer, Noam and Niki Parmar},
  booktitle = "Advances in Neural Information Processing Systems",
  year      = 2017,
  doi       = {10.48550/arXiv.1706.03762},
}
@comment{ignored @article{nope, title={No}} }
@article{lecun2015,
  title = {Deep learning},
  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  journal = {Nature},
  volume = {521},
  year = {2015},
  abstract = {Deep learning allows {computational} models\\ldots}
}
@misc{erdos, title = {Sch{\\"o}n {\\'e}t{\\'e} na{\\"\\i}ve \\& more}, author = {Paul Erd{\\H{o}}s}}
`;

  it("parses entries, skipping comments and strings", () => {
    const entries = parseBibtex(BIB);
    expect(entries.map((e) => `${e.type}:${e.key}`)).toEqual(["inproceedings:vaswani2017", "article:lecun2015", "misc:erdos"]);
    const v = bibEntryToFields(entries[0]!);
    expect(v).toMatchObject({
      title: "Attention Is All You Need",
      authors: ["Vaswani, Ashish", "Shazeer, Noam", "Parmar, Niki"],
      year: 2017,
      venue: "Advances in Neural Information Processing Systems",
      doi: "10.48550/arxiv.1706.03762",
      entryType: "inproceedings",
      citeKey: "vaswani2017",
    });
    const l = bibEntryToFields(entries[1]!);
    expect(l.venue).toBe("Nature");
    expect(l.authors).toHaveLength(3);
  });

  it("converts LaTeX accents and escapes", () => {
    expect(latexToText('Sch{\\"o}n {\\\'e}t{\\\'e} \\& G{\\"u}nter')).toBe("Schön été & Günter");
    expect(latexToText("{\\ss}e {\\o}re")).toBe("ße øre");
  });

  it("round-trips through export", () => {
    const f: CitationFields = { ...paper(), venue: "R&D 100% #1", doi: "10.1234/x", citeKey: null };
    const out = toBibtex(f, "vaswani2017attention");
    expect(out).toContain("@inproceedings{vaswani2017attention,");
    expect(out).toContain("booktitle = {R\\&D 100\\% \\#1}");
    expect(out).toContain("author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki}");
    const back = bibEntryToFields(parseBibtex(out)[0]!);
    expect(back).toMatchObject({ title: f.title, authors: f.authors, year: 2017, venue: "R&D 100% #1", doi: "10.1234/x", entryType: "inproceedings" });
  });
});

describe("Crossref", () => {
  const work = {
    title: ["Deep  learning"],
    author: [{ family: "LeCun", given: "Yann" }, { family: "Bengio", given: "Yoshua" }, { name: "The Consortium" }],
    issued: { "date-parts": [[2015, 5, 27]] },
    "container-title": ["Nature"],
    DOI: "10.1038/NATURE14539",
    URL: "http://dx.doi.org/10.1038/nature14539",
    abstract: "<jats:p>Deep learning allows <jats:italic>computational</jats:italic> models.</jats:p>",
    type: "journal-article",
  };

  it("maps a work to paper fields", () => {
    expect(crossrefToFields(work)).toEqual({
      title: "Deep learning",
      authors: ["LeCun, Yann", "Bengio, Yoshua", "The Consortium"],
      year: 2015,
      venue: "Nature",
      doi: "10.1038/nature14539",
      url: "http://dx.doi.org/10.1038/nature14539",
      abstract: "Deep learning allows computational models.",
      entryType: "article",
      citeKey: null,
    });
  });

  it("looks a DOI up with only the DOI in the request", async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ message: work }), { status: 200 });
    }) as unknown as typeof fetch;
    expect((await lookupDoi("https://doi.org/10.1038/nature14539", fake)).title).toBe("Deep learning");
    expect(urls).toEqual(["https://api.crossref.org/works/10.1038%2Fnature14539"]);
    const notFound = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(lookupDoi("10.1234/nope", notFound)).rejects.toThrow(/doesn't know this DOI/);
    await expect(lookupDoi("hello", fake)).rejects.toThrow(/Enter a DOI/);
    const offline = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    await expect(lookupDoi("10.1234/x", offline)).rejects.toThrow(/Couldn't reach Crossref/);
  });
});

describe("project helpers", () => {
  it("computes progress from milestones and tasks", () => {
    expect(projectProgress([{ done: true }, { done: false }], [{ done: true }, { done: true }])).toEqual({ done: 3, total: 4, ratio: 0.75 });
    expect(projectProgress([], [])).toEqual({ done: 0, total: 0, ratio: null });
  });

  it("extracts milestones from a guided project lesson", () => {
    const md = ["## Goal", "", "Build it.", "", "## Milestones", "", "1. **Data preparation.** Load and split.", "2. Train a `baseline` model. Then tune.", "   continuation line", "3) **Report:** write it up", "", "## Hints", "1. Not a milestone"].join("\n");
    expect(parseMilestones(md)).toEqual(["Data preparation", "Train a baseline model", "Report"]);
    expect(parseMilestones("no milestones here")).toEqual([]);
  });

  it("spreads due dates evenly", () => {
    expect(spreadDates("2026-10-01", "2026-10-31", 3)).toEqual(["2026-10-11", "2026-10-21", "2026-10-31"]);
    expect(spreadDates("2026-10-31", "2026-10-01", 3)).toEqual([]);
  });
});

describe("projects", () => {
  it("validates input", async () => {
    await expect(createProject(project({ title: " " }))).rejects.toThrow(/required/);
    await expect(createProject(project({ startDate: "2027-01-01", dueDate: "2026-01-01" }))).rejects.toThrow(/on or after/);
    await expect(createProject(project({ links: [{ label: "Repo", url: "javascript:alert(1)" }] }))).rejects.toThrow(/not a web address/);
    await expect(createProject(project({ members: [{ name: "Eleni", role: "Supervisor", email: "nope" }] }))).rejects.toThrow(/email/);
  });

  it("tracks milestones, tasks, progress and status", async () => {
    const p = await createProject(project({ members: [{ name: " Dr. Eleni ", role: "Supervisor", email: "" }, { name: "", role: "", email: "" }], links: [{ label: "", url: "https://github.com/me/thesis" }] }));
    expect(p.members).toEqual([{ name: "Dr. Eleni", role: "Supervisor", email: "" }]);
    expect(p.links).toEqual([{ label: "https://github.com/me/thesis", url: "https://github.com/me/thesis" }]);

    const a = await addMilestone(p.id, "Literature review", "2026-12-01");
    const b = await addMilestone(p.id, "Experiments", "2027-03-01");
    await addMilestone(p.id, "Write-up", null);
    await moveMilestone(p.id, b, -1);
    expect((await listMilestones(p.id)).map((m) => m.title)).toEqual(["Experiments", "Literature review", "Write-up"]);
    await setMilestoneDone(a, true);

    const t = await createTask({ title: "Set up repo", notes: null, courseId: null, assignmentId: null, projectId: p.id, dueAt: null, priority: "medium", status: "done", estimatedMinutes: null });
    // an update without projectId keeps the link
    const { projectId: _omit, ...withoutProject } = t;
    await updateTask(t.id, { ...withoutProject, title: "Set up the repo" });
    expect((await listTasks({ projectId: p.id }))[0]).toMatchObject({ title: "Set up the repo", projectTitle: p.title });

    const [summary] = await listProjects();
    expect(summary?.progress).toEqual({ done: 2, total: 4, ratio: 0.5 });
    expect(summary?.nextMilestone).toEqual({ title: "Experiments", dueDate: "2027-03-01" });

    await updateProject(p.id, { ...p, status: "completed" });
    expect(await listProjects({ status: "open" })).toHaveLength(0);
    expect(await listProjects({ status: "completed" })).toHaveLength(1);
  });

  it("shows deadlines and milestones on the calendar", async () => {
    const p = await createProject(project({ dueDate: "2026-11-20" }));
    await addMilestone(p.id, "Proposal", "2026-11-05");
    const done = await addMilestone(p.id, "Ethics form", "2026-11-06");
    await setMilestoneDone(done, true);
    await addMilestone(p.id, "Later", "2026-12-15");
    const items = await getCalendarItems("2026-11-01", "2026-11-30");
    expect(items.map((i) => [i.source, i.title, i.start, i.allDay, i.id])).toEqual([
      ["milestone", "Proposal", "2026-11-05T00:00", true, p.id],
      ["milestone", "Ethics form ✓", "2026-11-06T00:00", true, p.id],
      ["project", `Project due: ${p.title}`, "2026-11-20T00:00", true, p.id],
    ]);
    await updateProject(p.id, { ...p, status: "cancelled" });
    expect(await getCalendarItems("2026-11-01", "2026-11-30")).toHaveLength(0);
  });

  it("creates research workspace notes once per single section", async () => {
    const p = await createProject(project());
    const q1 = await getOrCreateSectionNote(p.id, "methodology");
    const q2 = await getOrCreateSectionNote(p.id, "methodology");
    expect(q2.id).toBe(q1.id);
    expect(q1.title).toBe(`Methodology — ${p.title}`);
    expect(q1.contentText).toContain("Threats to validity");
    await createProjectNote(p.id, "meeting");
    await createProjectNote(p.id, "meeting", "Meeting 2");
    const notes = await listProjectNotes(p.id);
    expect(notes.map((n) => n.section).sort()).toEqual(["meeting", "meeting", "methodology"]);
    expect((await getNote(q1.id))?.projectId).toBe(p.id);
  });

  it("starts a project from a guided lesson, once", async () => {
    const track = await createTrack({ title: "AI", description: null, color: null });
    const subject = await createSubject(track, "Projects");
    const lessonId = await createLesson({
      subjectId: subject,
      level: 2,
      title: "Linear regression from scratch",
      summary: "Implement it with NumPy.",
      content: "## Milestones\n\n1. **Data.** Load it.\n2. **Model.** Fit it.\n3. **Report.** Explain it.\n",
      estimatedMinutes: null,
      topicName: null,
    });
    const p = await startProjectFromLesson(lessonId, { startDate: "2026-10-01", dueDate: "2026-10-31" });
    expect(p).toMatchObject({ title: "Linear regression from scratch", kind: "ai", lessonId, description: "Implement it with NumPy." });
    expect((await listMilestones(p.id)).map((m) => [m.title, m.dueDate])).toEqual([
      ["Data", "2026-10-11"],
      ["Model", "2026-10-21"],
      ["Report", "2026-10-31"],
    ]);
    expect((await startProjectFromLesson(lessonId, { startDate: "2026-10-01", dueDate: null })).id).toBe(p.id);
  });

  it("deletes a project with its parts but keeps tasks and papers", async () => {
    const p = await createProject(project());
    await addMilestone(p.id, "M1", null);
    const note = await createProjectNote(p.id, "draft");
    const t = await createTask({ title: "Read papers", notes: null, courseId: null, assignmentId: null, projectId: p.id, dueAt: null, priority: "medium", status: "todo", estimatedMinutes: null });
    const pa = await createPaper(paper());
    await addPaperToProject(p.id, pa.id);
    await addAttachment({ type: "project", id: p.id }, { fileName: "plan.pdf", storedName: "x.pdf", mimeType: "application/pdf", sizeBytes: 10 });
    expect((await listAllAttachments())[0]?.ownerTitle).toBe(p.title);
    await deleteProject(p.id);
    expect(await getProject(p.id)).toBeNull();
    expect(await listMilestones(p.id)).toHaveLength(0);
    expect(await getNote(note.id)).toBeNull();
    expect(await listAllAttachments()).toHaveLength(0);
    expect((await listTasks()).find((x) => x.id === t.id)?.projectId).toBeNull();
    expect(await listPapers()).toHaveLength(1);
    expect(await projectsForPaper(pa.id)).toHaveLength(0);
  });
});

describe("papers", () => {
  it("validates, generates cite keys and rejects duplicates", async () => {
    await expect(createPaper(paper({ year: 17 }))).rejects.toThrow(/four-digit/);
    await expect(createPaper(paper({ doi: "abc" }))).rejects.toThrow(/DOI/);
    await expect(createPaper(paper({ rating: 6 }))).rejects.toThrow(/1 to 5/);
    const a = await createPaper(paper({ doi: "https://doi.org/10.48550/arXiv.1706.03762" }));
    expect(a.doi).toBe("10.48550/arxiv.1706.03762");
    expect(a.citeKey).toBe("vaswani2017attention");
    await expect(createPaper(paper({ title: "Other title", doi: "10.48550/ARXIV.1706.03762" }))).rejects.toThrow(/already in your library/);
    await expect(createPaper(paper({ title: " attention is all you need " }))).rejects.toThrow(/already in your library/);
    const b = await createPaper(paper({ title: "Attention, again", authors: ["Vaswani, A."] }));
    expect(b.citeKey).toBe("vaswani2017attentiona");
    await expect(createPaper(paper({ title: "X", citeKey: "vaswani2017attention" }))).rejects.toThrow(/already used/);
  });

  it("filters by status, project and text", async () => {
    const a = await createPaper(paper({ status: "reading" }));
    await createPaper(paper({ title: "Deep learning", authors: ["LeCun, Yann"], year: 2015, venue: "Nature" }));
    const proj = await createProject(project());
    await addPaperToProject(proj.id, a.id);
    await addPaperToProject(proj.id, a.id); // idempotent
    expect((await listPapers({ status: "reading" })).map((p) => p.title)).toEqual([a.title]);
    expect((await listPapers({ projectId: proj.id })).map((p) => p.id)).toEqual([a.id]);
    expect((await listPapers({ search: "lecun" })).map((p) => p.title)).toEqual(["Deep learning"]);
    expect((await listProjects())[0]?.paperCount).toBe(1);
    await removePaperFromProject(proj.id, a.id);
    expect(await listPapers({ projectId: proj.id })).toHaveLength(0);
    await addPaperToProject(proj.id, a.id); // re-adding restores the soft-deleted link
    expect(await listPapers({ projectId: proj.id })).toHaveLength(1);
  });

  it("imports BibTeX into the library and a project without duplicates", async () => {
    const proj = await createProject(project());
    await createPaper(paper({ title: "Deep learning", authors: ["LeCun, Yann"], year: 2015 }));
    const bib = "@article{lecun2015, title={Deep Learning}, author={LeCun, Yann}, year={2015}}\n@inproceedings{he2016, title={Deep Residual Learning for Image Recognition}, author={He, Kaiming and Zhang, Xiangyu}, booktitle={CVPR}, year={2016}}";
    const r = await importBibtex(bib, proj.id);
    expect(r.created.map((p) => p.citeKey)).toEqual(["he2016"]);
    expect(r.duplicates.map((d) => d.title)).toEqual(["Deep learning"]);
    expect(r.errors).toEqual([]);
    expect(await listPapers({ projectId: proj.id })).toHaveLength(2);
    expect((await importBibtex("nothing here")).errors[0]).toMatch(/No BibTeX entries/);
    const exported = papersToBibtex(await listPapers({ projectId: proj.id }));
    expect(parseBibtex(exported).map((e) => e.key).sort()).toEqual(["he2016", "lecun2015deep"]);
  });

  it("keeps one reading note per paper and cleans up on delete", async () => {
    const a = await createPaper(paper());
    const n1 = await getOrCreatePaperNote(a.id);
    expect((await getOrCreatePaperNote(a.id)).id).toBe(n1.id);
    expect(n1.contentText).toContain("How it relates to my work");
    expect(n1.paperId).toBe(a.id);
    const proj = await createProject(project());
    await addPaperToProject(proj.id, a.id);
    await deletePaper(a.id);
    expect(await getNote(n1.id)).toBeNull();
    expect(await listPapers({ projectId: proj.id })).toHaveLength(0);
  });
});

describe("search, knowledge and sync", () => {
  it("indexes projects and papers and follows deletes", async () => {
    const p = await createProject(project({ description: "Sharpness and generalisation." }));
    const a = await createPaper(paper({ abstract: "The Transformer, based solely on attention mechanisms." }));
    expect((await search("sharpness")).map((h) => [h.type, h.id])).toEqual([["project", p.id]]);
    expect((await search("transformer")).map((h) => h.type)).toEqual(["paper"]);
    expect((await search("vaswani")).map((h) => h.type)).toEqual(["paper"]);
    await deletePaper(a.id);
    expect(await search("transformer")).toEqual([]);
  });

  it("still indexes attachments after the table rebuild", async () => {
    const p = await createProject(project());
    await addAttachment({ type: "project", id: p.id }, { fileName: "proposal-draft.pdf", storedName: "y.pdf", mimeType: "application/pdf", sizeBytes: 5 });
    expect((await search("proposal")).map((h) => h.type)).toEqual(["attachment"]);
  });

  it("links concepts to papers and projects", async () => {
    const e = await createEntry({ title: "Self-attention", aliases: [], definition: "…", formula: null, intuition: null, examples: null });
    const a = await createPaper(paper());
    const p = await createProject(project());
    await linkEntry(e.id, "paper", a.id);
    await linkEntry(e.id, "project", p.id);
    expect((await linkedItems(e.id)).map((i) => [i.type, i.title, i.detail])).toEqual([
      ["paper", a.title, "2017"],
      ["project", p.title, null],
    ]);
  });

  it("syncs the new tables, parents before children", () => {
    const names = SYNC_TABLES.map((t) => t.name);
    for (const t of ["projects", "papers", "project_milestones", "project_papers"]) expect(names).toContain(t);
    expect(names.indexOf("projects")).toBeLessThan(names.indexOf("project_milestones"));
    expect(names.indexOf("papers")).toBeLessThan(names.indexOf("project_papers"));
    expect(names.indexOf("projects")).toBeLessThan(names.indexOf("tasks"));
    expect(names.indexOf("papers")).toBeLessThan(names.indexOf("notes"));
  });

  it("keeps existing data through migration 8", async () => {
    // migration ran in createTestDb; the rebuilt tables accept the new owner/target types
    const rows = await db.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'search_attachments_%' ORDER BY name");
    expect(rows.map((r) => r.name)).toEqual(["search_attachments_ad", "search_attachments_ai", "search_attachments_au"]);
  });
});
