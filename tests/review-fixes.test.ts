/** Regression tests for issues found in the full-app quality review. */
import { describe, expect, it } from "vitest";
import { createTestDb, runMigration } from "./testDb";
import { scaleFromPreset } from "../src/domain/grading";
import { fromDocId, toDocId } from "../src/sync/firestoreRemote";
import { SYNC_TABLES } from "../src/sync/engine";
import { applySnapshot, createSnapshot, exportProgramme, parseSnapshot } from "../src/services/backup";
import { ensureTag, listTags, setTags, tagsFor } from "../src/services/tags";
import { createInstitution } from "../src/services/institutions";
import { createProgramme } from "../src/services/programmes";
import { createCourse } from "../src/services/courses";
import { createNote, getNote } from "../src/services/notes";
import { createTrack, createSubject, createLesson } from "../src/services/learning";
import { createProject, getProject, listMilestones, startProjectFromLesson } from "../src/services/projects";

async function seedCourse() {
  const i = await createInstitution({ name: "UCY", kind: "university", country: null, website: null, notes: null });
  const p = await createProgramme({ institutionId: i.id, name: "MSc AI", level: "master", status: "active", field: null, startDate: null, endDate: null, totalCredits: 90, creditUnit: "ECTS", gradingScale: scaleFromPreset("ten_point"), targetGrade: null, color: null, notes: null });
  const c = await createCourse({ programmeId: p.id, semesterId: null, name: "ML", code: "MAI611", credits: 10, lecturer: null, lecturerEmail: null, location: null, status: "in_progress", finalGrade: null, targetGrade: null, color: null, description: null });
  return { programme: p, course: c };
}

describe("sync ids and order", () => {
  it("encodes '/' in cloud document ids without changing other ids", () => {
    expect(toDocId("tag:ci/cd")).toBe("tag:ci%2Fcd");
    expect(fromDocId(toDocId("tag:a/b/c|note|x"))).toBe("tag:a/b/c|note|x");
    expect(toDocId("tag:exam|note|123")).toBe("tag:exam|note|123");
  });

  it("syncs lessons before the projects started from them", () => {
    const names = SYNC_TABLES.map((t) => t.name);
    expect(names.indexOf("lessons")).toBeLessThan(names.indexOf("projects"));
    expect(names.indexOf("projects")).toBeLessThan(names.indexOf("notes"));
    expect(names.indexOf("projects")).toBeLessThan(names.indexOf("tasks"));
  });
});

describe("tags with the same name from different devices", () => {
  it("migration 9 keeps every tag link", async () => {
    const db = await createTestDb({ upTo: 8 });
    const now = "2026-10-07T10:00:00.000Z";
    await db.execute("INSERT INTO tag_links (id, tag_id, entity_type, entity_id, source, created_at, updated_at) VALUES ('tag-exam|note|n1|manual', 'tag-exam', 'note', 'n1', 'manual', $1, $1)", [now]);
    runMigration(db, 9);
    expect(await db.select("SELECT id, tag_id, updated_at FROM tag_links")).toEqual([{ id: "tag-exam|note|n1|manual", tag_id: "tag-exam", updated_at: now }]);
    // A second row with the same name (as pulled from another device) is now accepted.
    await db.execute("INSERT INTO tags (id, name, created_at, updated_at) VALUES ('tag:exam', 'exam', $1, $1)", [now]);
    expect((await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM tags WHERE name = 'exam'"))[0]!.n).toBe(2);
  });

  it("shows duplicates as one tag and reuses the canonical id", async () => {
    const db = await createTestDb();
    await db.execute("INSERT INTO tags (id, name, created_at, updated_at) VALUES ('tag:exam', 'exam', 'x', 'x')");
    const tags = (await listTags()).filter((t) => t.name === "exam");
    expect(tags).toHaveLength(1);
    expect(tags[0]!.id).toBe("tag:exam");
    expect(await ensureTag("Exam")).toBe("tag:exam");
    await setTags("note", "n1", ["exam", "ci/cd"]);
    expect(await tagsFor("note", "n1")).toEqual(["ci/cd", "exam"]);
  });
});

describe("restore and import robustness", () => {
  it("restores a project started from a lesson into an empty database", async () => {
    await createTestDb();
    const track = await createTrack({ title: "AI", description: null, color: null });
    const subject = await createSubject(track, "Projects");
    const lessonId = await createLesson({ subjectId: subject, level: 2, title: "Linear regression", summary: null, content: "## Milestones\n\n1. **Data.** Load.\n2. **Model.** Fit.\n", estimatedMinutes: null, topicName: null });
    const p = await startProjectFromLesson(lessonId, { startDate: "2026-10-01", dueDate: null });
    const snap = parseSnapshot(JSON.stringify(await createSnapshot()));

    await createTestDb();
    const r = await applySnapshot(snap, { replace: true });
    expect(r.failed).toBe(0);
    expect((await getProject(p.id))?.lessonId).toBe(lessonId);
    expect(await listMilestones(p.id)).toHaveLength(2);
  });

  it("imports programme notes that belonged to a project elsewhere", async () => {
    await createTestDb();
    const { programme, course } = await seedCourse();
    const project = await createProject({ title: "Thesis", kind: "thesis", status: "active", description: null, researchQuestion: null, courseId: course.id, startDate: null, dueDate: null, members: [], links: [] });
    const note = await createNote({ courseId: course.id, projectId: project.id, section: "draft", title: "Draft 1" });
    const exp = parseSnapshot(JSON.stringify(await exportProgramme(programme.id)));

    await createTestDb();
    const r = await applySnapshot(exp, { replace: false });
    expect(r.failed).toBe(0);
    expect(await getNote(note.id)).toMatchObject({ title: "Draft 1", courseId: course.id, projectId: null });
  });
});

describe("calculations", async () => {
  const { parseNumber } = await import("../src/domain/questions");
  const { formatGrade, isPassing, scaleFromPreset } = await import("../src/domain/grading");
  const { planRevision } = await import("../src/domain/planner");
  const { start, stop, TIMER_MODES } = await import("../src/features/study/timerMachine");
  const { formatDuration } = await import("../src/domain/time");

  it("reads common number formats in answers", () => {
    expect(parseNumber("1,000")).toBe(1000);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("0,125")).toBe(0.125);
    expect(parseNumber("1 1/2")).toBe(1.5);
    expect(parseNumber("-1 1/2")).toBe(-1.5);
    expect(parseNumber("−5")).toBe(-5);
    expect(parseNumber("1.5e3")).toBe(1500);
    expect(parseNumber("45%")).toBe(45);
    expect(parseNumber("3/4")).toBe(0.75);
    expect(parseNumber("0x10")).toBeNull();
    expect(parseNumber("Infinity")).toBeNull();
    expect(parseNumber("1/0")).toBeNull();
  });

  it("keeps grade text, letter and pass mark consistent", () => {
    const letter = scaleFromPreset("letter");
    expect(formatGrade(letter, 3.699)).toBe("A- (3.70)");
    const ten = scaleFromPreset("ten_point");
    expect(formatGrade(ten, 4.996)).toBe("5.00");
    expect(isPassing(ten, 4.996)).toBe(true);
  });

  it("gives every topic a session when there is room", () => {
    const plan = planRevision({ from: "2026-10-09", examDate: "2026-10-11", busy: [], sessionMinutes: 60, maxSessionsPerDay: 2, topics: [{ name: "A", weight: 10 }, { name: "B", weight: 1 }, { name: "C", weight: 1 }] });
    const topics = plan.map((p) => p.topic);
    expect(topics).toContain("B");
    expect(topics).toContain("C");
  });

  it("never records more than one block when stopping after sleep", () => {
    const t0 = 1_000_000;
    const s = start(TIMER_MODES[0]!, { courseId: null, programmeId: null, topic: null, taskId: null }, t0, "2026-10-07T10:00");
    const { effects } = stop(s, t0 + 3 * 60 * 60_000);
    expect(JSON.stringify(effects)).toContain('"minutes":25');
  });

  it("formats negative and fractional durations", () => {
    expect(formatDuration(-30)).toBe("-30 min");
    expect(formatDuration(90.5)).toBe("1 h 31 min");
    expect(formatDuration(125)).toBe("2 h 5 min");
  });
});

describe("calendar import", async () => {
  const { crossesClockChange } = await import("../src/services/icsTransfer");
  it("spots weekly UTC times that cross a clock change (Cyprus)", () => {
    // Europe/Nicosia changes on the last Sundays of March and October.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz !== "Europe/Nicosia") return; // offsets depend on the machine's zone
    expect(crossesClockChange("2026-10-01", "2026-12-17", "09:00")).toBe(true);
    expect(crossesClockChange("2026-11-01", "2026-12-17", "09:00")).toBe(false);
  });
});

describe("untrusted content", async () => {
  const { renderMarkdown } = await import("../src/lib/markdown");
  const { extractJson, parseFlashcards } = await import("../src/domain/aiPrompts");
  const { docToMarkdown, markdownToNodes } = await import("../src/domain/noteMarkdown");
  const { latexToText, parseBibtex } = await import("../src/domain/research");

  it("keeps maths in image alt text and link titles inside the attribute", () => {
    const html = renderMarkdown('![$x^2$](http://a/b.png) and [t](http://a "$y$")');
    expect(html).toContain('alt="$x^2$"');
    expect(html).toContain('title="$y$"');
    expect(html).not.toMatch(/alt="<span/);
    // Marker characters typed by the user can't pull in other formulas.
    expect(renderMarkdown("M0 and $z$")).not.toMatch(/^<p><span class="katex">.*<span class="katex">/);
  });

  it("parses AI JSON whose strings contain code fences", () => {
    const reply = '```json\n{"cards": [{"front": "Print in Python?", "back": "```py\\nprint(1)\\n```"}]}\n```';
    expect(parseFlashcards(reply)[0]!.back).toContain("print(1)");
    expect(extractJson('{"a": "```"}')).toEqual({ a: "```" });
  });

  it("exports images and tables to Markdown", () => {
    const md = docToMarkdown({
      type: "doc",
      content: [
        { type: "image", attrs: { alt: "diagram.png", storedName: "x.png" } },
        {
          type: "table",
          content: [
            { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] }, { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] }] },
            { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "x|y" }] }] }] },
          ],
        },
      ],
    });
    expect(md).toBe("[image: diagram.png]\n\n| A | B |\n| --- | --- |\n| 1 | x\\|y |");
    expect(renderMarkdown(md)).toContain("<table>");
  });

  it("doesn't turn prices into maths and survives hostile replies", () => {
    const p = markdownToNodes("It costs $5 and $10 per month.")[0]!;
    expect(p.content!.every((n) => n.type === "text")).toBe(true);
    const t0 = Date.now();
    markdownToNodes("[".repeat(40_000));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(() => markdownToNodes(">".repeat(20_000) + " deep")).not.toThrow();
  });

  it("keeps LaTeX commands that start with c or v, and separates unclosed BibTeX entries", () => {
    expect(latexToText("\\cite{x} \\vspace ok \\c{c}a \\v s")).toBe("\\citex \\vspace ok ça š");
    const entries = parseBibtex("@article{k, title={A}\n@book{b, title={B}}");
    expect(entries.map((e) => [e.key, e.fields.title])).toEqual([["k", "A"], ["b", "B"]]);
  });
});
