import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createTestDb } from "./testDb";
import type { DbDriver } from "../src/lib/db/driver";
import { setDb } from "../src/lib/db";
import { countPendingChanges, syncOnce, type RemoteRow, type RemoteStore, type RowData } from "../src/sync/engine";
import { scaleFromPreset } from "../src/domain/grading";
import {
  applySnapshot,
  autoBackupDue,
  backupStamp,
  createSnapshot,
  exportProgramme,
  parseSnapshot,
  SCHEMA_VERSION,
  stampToDate,
  summarize,
} from "../src/services/backup";
import { courseNotesMarkdown, fileSafe, flashcardsCsv, gradesCsv, noteMarkdown, projectMarkdown, tasksCsv, toCsv } from "../src/services/exporters";
import { createInstitution } from "../src/services/institutions";
import { createProgramme, listProgrammes } from "../src/services/programmes";
import { createCourse, getCourse, listCourses, updateCourse } from "../src/services/courses";
import { createLecture } from "../src/services/lectures";
import { createNote, deleteNote, getNote, listNotes, saveNote } from "../src/services/notes";
import { createAssignment, createExam } from "../src/services/assessments";
import { createTask } from "../src/services/tracking";
import { createFlashcard } from "../src/services/practice";
import { addMilestone, createProject, createProjectNote } from "../src/services/projects";
import { createPaper, addPaperToProject } from "../src/services/papers";
import { search } from "../src/services/search";
import { getSetting, setSetting } from "../src/services/settings";

class FakeRemote implements RemoteStore {
  clock = 1000;
  tables = new Map<string, Map<string, RemoteRow>>();
  async pull(table: string, sinceMs: number) {
    return [...(this.tables.get(table)?.values() ?? [])].filter((r) => r.syncedAtMs > sinceMs).sort((a, b) => a.syncedAtMs - b.syncedAtMs);
  }
  async push(table: string, rows: { id: string; data: RowData }[]) {
    const t = this.tables.get(table) ?? new Map<string, RemoteRow>();
    for (const r of rows) t.set(r.id, { id: r.id, data: { ...r.data }, syncedAtMs: ++this.clock });
    this.tables.set(table, t);
  }
}

const on = async <T,>(device: DbDriver, fn: () => Promise<T>): Promise<T> => {
  setDb(device);
  return fn();
};

const doc = (text: string) => JSON.stringify({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Key idea" }] }, { type: "paragraph", content: [{ type: "text", text }] }] });

async function seed() {
  const i = await createInstitution({ name: "University of Cyprus", kind: "university", country: "Cyprus", website: null, notes: null });
  const p = await createProgramme({
    institutionId: i.id,
    name: "MSc AI",
    level: "master",
    status: "active",
    field: null,
    startDate: null,
    endDate: null,
    totalCredits: 90,
    creditUnit: "ECTS",
    gradingScale: scaleFromPreset("ten_point"),
    targetGrade: null,
    color: null,
    notes: null,
  });
  const c = await createCourse({ programmeId: p.id, semesterId: null, name: "Machine Learning", code: "MAI611", credits: 10, lecturer: null, lecturerEmail: null, location: null, status: "in_progress", finalGrade: null, targetGrade: null, color: null, description: null });
  return { institution: i, programme: p, course: c };
}

describe("snapshots", () => {
  it("knows every migration", () => {
    const files = readdirSync(join(__dirname, "../src-tauri/migrations")).filter((f) => f.endsWith(".sql"));
    expect(SCHEMA_VERSION).toBe(files.length);
  });

  it("rejects files that aren't usable backups", () => {
    expect(() => parseSnapshot("not json")).toThrow(/valid JSON/);
    expect(() => parseSnapshot('{"format": "other"}')).toThrow(/isn't a StudyOS backup/);
    expect(() => parseSnapshot(JSON.stringify({ format: "studyos-backup", version: 1, schemaVersion: SCHEMA_VERSION + 1, tables: {} }))).toThrow(/newer version/);
    expect(() => parseSnapshot(JSON.stringify({ format: "studyos-backup", version: 1, schemaVersion: 1, tables: { courses: [{ name: "x" }] } }))).toThrow(/rows without id/);
    expect(() => parseSnapshot(JSON.stringify({ format: "studyos-backup", version: 1, schemaVersion: 1, tables: { notes: "x" } }))).toThrow(/damaged/);
    // Unknown tables are ignored.
    expect(parseSnapshot(JSON.stringify({ format: "studyos-backup", version: 1, schemaVersion: 1, scope: "all", createdAt: "x", tables: { mystery: [1] } })).scope).toBe("all");
  });

  it("restores the backed-up state exactly and survives a JSON round trip", async () => {
    await createTestDb();
    const { course } = await seed();
    const keep = await createNote({ courseId: course.id, title: "Gradient descent" });
    await saveNote(keep.id, "Gradient descent", doc("Step against the gradient."));
    const removedLater = await createNote({ courseId: course.id, title: "To be deleted" });
    await setSetting("theme", "light");
    const backup = parseSnapshot(JSON.stringify(await createSnapshot()));
    expect(summarize(backup).counts).toMatchObject({ courses: 1, notes: 2 });

    // Changes after the backup.
    await updateCourse(course.id, { ...(await getCourse(course.id))!, name: "Renamed" });
    await deleteNote(removedLater.id);
    const extra = await createNote({ courseId: course.id, title: "Written after the backup" });
    await setSetting("theme", "dark");

    const r = await applySnapshot(backup, { replace: true });
    expect(r.failed).toBe(0);
    expect(r.removed).toBe(1);
    expect((await getCourse(course.id))?.name).toBe("Machine Learning");
    expect((await listNotes()).map((n) => n.title).sort()).toEqual(["Gradient descent", "To be deleted"]);
    expect(await getNote(extra.id)).toBeNull();
    expect(await getSetting("theme")).toBe("light");
    // The search index follows the restore.
    expect((await search("gradient")).map((h) => h.id)).toEqual([keep.id]);
    expect(await search("written after")).toEqual([]);
  });

  it("drops columns the current schema doesn't have and keeps defaults for missing ones", async () => {
    await createTestDb();
    const { course } = await seed();
    const snap = await createSnapshot();
    const row = snap.tables.courses!.find((c) => c.id === course.id)!;
    row.obsolete_column = "x";
    delete row.color;
    const r = await applySnapshot(snap, { replace: true });
    expect(r.failed).toBe(0);
    expect((await getCourse(course.id))?.color).toBeNull();
  });

  it("pushes a restore to other devices instead of being overwritten by them", async () => {
    const remote = new FakeRemote();
    const laptop = await createTestDb();
    const desktop = await createTestDb();
    const { course } = await on(laptop, seed);
    await on(laptop, () => syncOnce(laptop, remote));
    const backup = await on(laptop, createSnapshot);

    // Later edits reach the cloud and the desktop.
    await on(laptop, async () => updateCourse(course.id, { ...(await getCourse(course.id))!, name: "Renamed later" }));
    const later = await on(laptop, () => createNote({ courseId: course.id, title: "Later note" }));
    await on(laptop, () => syncOnce(laptop, remote));
    await on(desktop, () => syncOnce(desktop, remote));
    expect((await on(desktop, () => getCourse(course.id)))?.name).toBe("Renamed later");

    // Restore on the laptop, sync both ways.
    await on(laptop, () => applySnapshot(backup, { replace: true }));
    expect(await countPendingChanges(laptop)).toBeGreaterThan(0);
    await on(laptop, () => syncOnce(laptop, remote));
    await on(desktop, () => syncOnce(desktop, remote));
    expect((await on(desktop, () => getCourse(course.id)))?.name).toBe("Machine Learning");
    expect(await on(desktop, () => getNote(later.id))).toBeNull();
  });

  it("exports a programme and merges it into another database", async () => {
    await createTestDb();
    const { programme, course } = await seed();
    const lecture = await createLecture({ courseId: course.id, number: 1, title: "Intro", date: "2026-10-05", startTime: null, lecturer: null, links: [], comments: null, revisionStatus: "not_reviewed" });
    await createNote({ lectureId: lecture.id, title: "Lecture 1" });
    await createFlashcard({ front: "Bias?", back: "…", courseId: course.id, lessonId: null, noteId: null, subjectId: null, tags: [], topicName: "Bias" });
    // Another programme that must not be exported.
    const other = await createProgramme({ ...programme, name: "Other", gradingScale: programme.gradingScale });
    await createCourse({ programmeId: other.id, semesterId: null, name: "Elsewhere", code: null, credits: null, lecturer: null, lecturerEmail: null, location: null, status: "planned", finalGrade: null, targetGrade: null, color: null, description: null });

    const exp = parseSnapshot(JSON.stringify(await exportProgramme(programme.id)));
    expect(exp).toMatchObject({ format: "studyos-export", scope: "programme", title: "MSc AI" });
    expect(exp.tables.courses!.map((c) => c.name)).toEqual(["Machine Learning"]);
    expect(exp.tables.topics).toHaveLength(1);

    await createTestDb();
    const mine = await seed(); // existing data must survive a merge import
    const r = await applySnapshot(exp, { replace: false });
    expect(r).toMatchObject({ failed: 0, removed: 0 });
    expect((await listProgrammes()).length).toBe(2);
    expect((await listCourses()).map((c) => c.id)).toContain(mine.course.id);
    expect(await listNotes({ lectureId: lecture.id })).toHaveLength(1);
  });

  it("schedules automatic backups daily", () => {
    const now = new Date(2026, 9, 7, 12, 0, 0);
    expect(backupStamp(now)).toBe("20261007-120000");
    expect(stampToDate("20261007-120000").getTime()).toBe(now.getTime());
    expect(autoBackupDue([], now)).toBe(true);
    expect(autoBackupDue([{ kind: "auto", stamp: "20261007-080000" }], now)).toBe(false);
    expect(autoBackupDue([{ kind: "auto", stamp: "20261006-110000" }, { kind: "manual", stamp: "20261007-110000" }], now)).toBe(true);
  });
});

describe("exports", () => {
  it("writes safe CSV", () => {
    const csv = toCsv(["A", "B"], [["x,y", 'say "hi"'], ["=HYPERLINK(1)", -3], ["line\nbreak", null]]);
    expect(csv).toBe('\uFEFFA,B\r\n"x,y","say ""hi"""\r\n\'=HYPERLINK(1),-3\r\n"line\nbreak",\r\n');
  });

  it("exports grades, tasks and flashcards as CSV", async () => {
    await createTestDb();
    const { course } = await seed();
    await createAssignment({ courseId: course.id, title: "Assignment 1", kind: "assignment", description: null, dueAt: "2026-10-20T23:59", weight: 20, status: "graded", score: 18, maxScore: 20, checklist: [], notes: null });
    await createExam({ courseId: course.id, title: "Final", kind: "final", startAt: "2027-01-15T09:00", durationMinutes: 120, location: null, topics: [], notes: null, weight: 80, score: null, maxScore: null });
    const grades = (await gradesCsv()).split("\r\n");
    expect(grades[0]).toBe("\uFEFFCourse code,Course,Type,Title,Status,Date,Weight %,Score,Max score,Percent");
    expect(grades[1]).toBe("MAI611,Machine Learning,Assignment,Assignment 1,Graded,2026-10-20 23:59,20,18,20,90");
    expect(grades[2]).toBe("MAI611,Machine Learning,Final exam,Final,,2027-01-15 09:00,80,,,");

    await createTask({ title: "Read chapter 3", notes: null, courseId: course.id, assignmentId: null, dueAt: null, priority: "high", status: "todo", estimatedMinutes: 45 });
    expect((await tasksCsv()).split("\r\n")[1]).toBe("Read chapter 3,To do,High,,Machine Learning,,45,,");

    await createFlashcard({ front: "What is $x$?", back: "A variable, \"x\"", courseId: course.id, lessonId: null, noteId: null, subjectId: null, tags: ["algebra"], topicName: null });
    expect((await flashcardsCsv(course.id)).split("\r\n")[1]).toBe('What is $x$?,"A variable, ""x""",algebra');
  });

  it("exports notes, course notes and projects as Markdown", async () => {
    await createTestDb();
    const { course } = await seed();
    const n = await createNote({ courseId: course.id, title: "Regularisation" });
    await saveNote(n.id, "Regularisation", doc("L2 adds $\\lambda \\lVert w \\rVert^2$."));
    const note = await noteMarkdown(n.id);
    expect(note.markdown).toMatch(/^# Regularisation\n\n\*\*Course:\*\* MAI611 · Machine Learning · \*\*Updated:\*\* .+\n\n## Key idea\n\nL2 adds \$\\lambda \\lVert w \\rVert\^2\$\.\n$/);

    const lecture = await createLecture({ courseId: course.id, number: 2, title: "Trees", date: "2026-10-12", startTime: null, lecturer: null, links: [], comments: null, revisionStatus: "not_reviewed" });
    await createNote({ lectureId: lecture.id, title: "Lecture 2 — Trees" });
    const all = await courseNotesMarkdown(course.id);
    expect(all.markdown).toContain("# MAI611 · Machine Learning");
    expect(all.markdown.indexOf("## Lecture 2 — Trees")).toBeLessThan(all.markdown.indexOf("## Regularisation"));
    expect(all.markdown).toContain("### Key idea"); // note headings are demoted under the note title

    const p = await createProject({ title: "Thesis", kind: "thesis", status: "active", description: "About **robustness**.", researchQuestion: "Does SAM help?", courseId: null, startDate: null, dueDate: null, members: [], links: [{ label: "Repo", url: "https://github.com/x/y" }] });
    await addMilestone(p.id, "Proposal", "2026-11-01");
    await createProjectNote(p.id, "methodology");
    const paper = await createPaper({ title: "Sharpness-Aware Minimization", authors: ["Foret, Pierre"], year: 2021, venue: "ICLR", doi: null, url: null, abstract: null, entryType: "inproceedings", citeKey: null, summary: null, status: "read", rating: null });
    await addPaperToProject(p.id, paper.id);
    const md = (await projectMarkdown(p.id)).markdown;
    expect(md).toContain("## Research question\n\nDoes SAM help?");
    expect(md).toContain("- [ ] Proposal");
    expect(md).toContain("- [Repo](https://github.com/x/y)");
    expect(md).toContain("## Methodology — Thesis");
    expect(md).toContain("## References\n\nForet, P. (2021). Sharpness-Aware Minimization. *ICLR*.");
  });

  it("makes file-name-safe titles", () => {
    expect(fileSafe('MAI611: "Machine/Learning"?')).toBe("MAI611 Machine Learning");
    expect(fileSafe("Μηχανική Μάθηση")).toBe("Μηχανικη Μαθηση");
    expect(fileSafe("...")).toBe("studyos-export");
  });
});
