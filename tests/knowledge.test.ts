import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import type { DbDriver } from "../src/lib/db/driver";
import { scaleFromPreset } from "../src/domain/grading";
import { parseQuestion } from "../src/domain/askIntents";
import { createInstitution } from "../src/services/institutions";
import { createProgramme } from "../src/services/programmes";
import { createCourse, deleteCourse } from "../src/services/courses";
import { createLecture } from "../src/services/lectures";
import { createNote, deleteNote, saveNote } from "../src/services/notes";
import { createAssignment, createExam } from "../src/services/assessments";
import { buildMatchQuery, search } from "../src/services/search";
import { extractHashtags, itemsWithTag, listTags, setTags, tagsFor } from "../src/services/tags";
import { createEntry, deleteEntry, entriesFor, flashcardsFromEntry, linkEntry, linkedItems, listEntries, saveConceptFromNote } from "../src/services/knowledge";
import { listFlashcards } from "../src/services/practice";
import { ask, NOT_FOUND } from "../src/services/ask";
import { syncOnce, type RemoteRow, type RemoteStore, type RowData } from "../src/sync/engine";

let db: DbDriver;
let courseId: string;

const doc = (text: string) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

beforeEach(async () => {
  db = await createTestDb();
  const i = await createInstitution({ name: "UCY", kind: "university", country: null, website: null, notes: null });
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
    targetGrade: 9.5,
    color: null,
    notes: null,
  });
  courseId = (
    await createCourse({ programmeId: p.id, semesterId: null, name: "Machine Learning", code: "MAI611", credits: 10, lecturer: null, lecturerEmail: null, location: null, status: "in_progress", finalGrade: null, targetGrade: null, color: null, description: null })
  ).id;
});

describe("full-text search", () => {
  it("builds safe prefix queries", () => {
    expect(buildMatchQuery('Gradient "descent" OR -x')).toBe("gradient* descent* or* x*");
    expect(buildMatchQuery("  ?! ")).toBeNull();
  });

  it("indexes items through triggers and follows updates and deletes", async () => {
    const n = await createNote({ courseId, title: "Optimisation" });
    await saveNote(n.id, "Optimisation", doc("Gradient descent updates parameters against the gradient."));
    await createAssignment({ courseId, title: "Gradient checking", kind: "assignment", description: null, dueAt: null, weight: null, status: "not_started", score: null, maxScore: null, checklist: [], notes: null });
    const hits = await search("gradi desc");
    expect(hits.map((h) => h.type)).toEqual(["note"]); // both words must match
    expect(hits[0]?.snippet).toContain("[[Gradient]]");
    expect((await search("gradient")).map((h) => h.type).sort()).toEqual(["assignment", "note"]);
    expect((await search("gradient", { types: ["assignment"] })).length).toBe(1);

    await saveNote(n.id, "Optimisation", doc("Newton's method."));
    expect((await search("descent")).length).toBe(0);
    await deleteNote(n.id);
    expect((await search("newton")).length).toBe(0);
  });

  it("matches without accents and finds Greek text", async () => {
    const n = await createNote({ title: "Café notes" });
    await saveNote(n.id, "Café notes", doc("Μηχανική μάθηση και δίκτυα"));
    expect((await search("cafe")).length).toBe(1);
    expect((await search("μάθηση")).length).toBe(1);
  });

  it("hides content of deleted courses and ranks title matches first", async () => {
    await createLecture({ courseId, number: 1, title: "Regularisation", date: null, startTime: null, lecturer: null, links: [], comments: null, revisionStatus: "not_reviewed" });
    const other = await createNote({ title: "Misc" });
    await saveNote(other.id, "Misc", doc("Regularisation reduces overfitting."));
    expect((await search("regularisation"))[0]?.type).toBe("lecture");
    await deleteCourse(courseId);
    expect((await search("regularisation")).map((h) => h.type)).toEqual(["note"]);
  });

  it("re-indexes rows arriving through sync", async () => {
    class Remote implements RemoteStore {
      rows = new Map<string, RemoteRow[]>();
      async pull(table: string, since: number) {
        return (this.rows.get(table) ?? []).filter((r) => r.syncedAtMs > since);
      }
      async push(table: string, rows: { id: string; data: RowData }[]) {
        this.rows.set(table, [...(this.rows.get(table) ?? []), ...rows.map((r, i) => ({ id: r.id, data: r.data, syncedAtMs: Date.now() + i }))]);
      }
    }
    const remote = new Remote();
    const n = await createNote({ title: "Synced" });
    await saveNote(n.id, "Synced", doc("backpropagation"));
    await syncOnce(db, remote);
    const other = await createTestDb();
    await syncOnce(other, remote);
    expect((await search("backprop")).length).toBe(1);
  });
});

describe("tags", () => {
  it("extracts hashtags from notes and keeps them in sync", async () => {
    expect(extractHashtags("This is #confusing and #Exam-2 but not a#b or #1")).toEqual(["confusing", "exam-2"]);
    const n = await createNote({ title: "Kernels" });
    await saveNote(n.id, "Kernels", doc("The kernel trick is #confusing #exam"));
    expect(await tagsFor("note", n.id)).toEqual(["confusing", "exam"]);
    await saveNote(n.id, "Kernels", doc("Now clear. #exam"));
    expect(await tagsFor("note", n.id)).toEqual(["exam"]);
  });

  it("combines manual and inline tags and lists tagged items", async () => {
    const n = await createNote({ title: "SVM" });
    await saveNote(n.id, "SVM", doc("margins #confusing"));
    await setTags("note", n.id, ["important"]);
    expect(await tagsFor("note", n.id)).toEqual(["confusing", "important"]);
    const l = await createLecture({ courseId, number: 2, title: "Kernels", date: null, startTime: null, lecturer: null, links: [], comments: null, revisionStatus: "not_reviewed" });
    await setTags("lecture", l.id, ["#Confusing"]);
    expect((await itemsWithTag("confusing")).map((i) => i.title).sort()).toEqual(["Kernels", "SVM"]);
    expect((await search("margins", { tag: "confusing" })).length).toBe(1);
    expect((await search("margins", { tag: "exam" })).length).toBe(0);
    expect((await listTags()).find((t) => t.name === "confusing")?.count).toBe(2);
  });
});

describe("knowledge base", () => {
  it("saves concepts from notes, links them across courses and makes flashcards", async () => {
    const lecture = await createLecture({ courseId, number: 3, title: "Optimisation", date: null, startTime: null, lecturer: null, links: [], comments: null, revisionStatus: "not_reviewed" });
    const note = await createNote({ lectureId: lecture.id, title: "L3" });
    const e = await saveConceptFromNote("Gradient descent", "Iteratively step against the gradient.", { noteId: note.id, lectureId: lecture.id, courseId });
    const again = await saveConceptFromNote("gradient descent", "", { noteId: note.id, lectureId: null, courseId: null });
    expect(again.id).toBe(e.id); // same concept, not a duplicate
    expect((await linkedItems(e.id)).map((i) => i.type).sort()).toEqual(["course", "lecture", "note"]);
    expect((await entriesFor("lecture", lecture.id)).map((x) => x.title)).toEqual(["Gradient descent"]);
    expect((await listEntries({ courseId })).length).toBe(1);

    const withFormula = { ...e, formula: "\\theta \\leftarrow \\theta - \\alpha \\nabla J" };
    expect(await flashcardsFromEntry(withFormula, courseId)).toBe(2);
    expect((await listFlashcards({ courseId })).length).toBe(2);
    expect((await linkedItems(e.id)).filter((i) => i.type === "flashcard").length).toBe(2);
    expect((await search("iteratively", { types: ["concept"] })).length).toBe(1);
  });

  it("skips links to deleted items and removes entries", async () => {
    const e = await createEntry({ title: "Entropy", aliases: ["information entropy"], definition: "Expected surprise.", formula: null, intuition: null, examples: null });
    const note = await createNote({ title: "Info theory" });
    await linkEntry(e.id, "note", note.id);
    await deleteNote(note.id);
    expect(await linkedItems(e.id)).toEqual([]);
    expect((await listEntries({ search: "information entropy" })).length).toBe(1);
    await deleteEntry(e.id);
    expect(await listEntries()).toEqual([]);
  });
});

describe("Ask My Studies", () => {
  const today = "2026-10-08";

  it("understands the spec's example questions", () => {
    expect(parseQuestion("What did I write about gradient descent?", today)).toEqual({ kind: "wroteAbout", topic: "gradient descent" });
    expect(parseQuestion("When is my Machine Learning exam?", today)).toEqual({ kind: "examWhen", subject: "machine learning" });
    expect(parseQuestion("What assignments are due this month?", today)).toMatchObject({ kind: "due", from: "2026-10-08", to: "2026-10-31" });
    expect(parseQuestion("Show me everything I marked as confusing.", today)).toEqual({ kind: "tagged", tag: "confusing" });
    expect(parseQuestion("Which topics have I not reviewed?", today)).toEqual({ kind: "notReviewed" });
    expect(parseQuestion("What was my grade on Assignment 2?", today)).toEqual({ kind: "grade", item: "assignment 2" });
    expect(parseQuestion("tell me about eigenvectors", today)).toEqual({ kind: "search", text: "eigenvectors" });
  });

  it("answers from stored data", async () => {
    await createExam({ courseId, title: "Machine Learning final", kind: "final", startAt: "2027-01-15T09:00", durationMinutes: 180, location: "Hall A", topics: [], notes: null, weight: 60, score: null, maxScore: null });
    await createAssignment({ courseId, title: "Assignment 2", kind: "assignment", description: null, dueAt: "2026-10-20T23:59", weight: 20, status: "graded", score: 18, maxScore: 20, checklist: [], notes: null });
    const n = await createNote({ courseId, title: "Optimisation" });
    await saveNote(n.id, "Optimisation", doc("Gradient descent: choose the learning rate carefully. #confusing"));

    const exam = await ask("When is my Machine Learning exam?", today);
    expect(exam.found).toBe(true);
    // Dates use the machine's locale, so check the parts rather than one format.
    expect(exam.text).toMatch(/15/);
    expect(exam.text).toContain("2027");
    expect(exam.text).toContain("09:00");
    expect(exam.text).toContain("Hall A");

    expect((await ask("What assignments are due this month?", today)).items[0]?.label).toBe("Assignment 2");
    expect((await ask("What was my grade on Assignment 2?", today)).text).toContain("18/20");
    expect((await ask("Show me everything I marked as confusing", today)).items[0]?.label).toBe("Optimisation");
    expect((await ask("What did I write about gradient descent?", today)).items[0]?.href).toBe(`/notes/${n.id}`);
  });

  it("says when it can't find something instead of guessing", async () => {
    expect(await ask("When is my Quantum Chemistry exam?", today)).toMatchObject({ found: false, text: NOT_FOUND });
    expect((await ask("What was my grade on the thesis?", today)).found).toBe(false);
    expect((await ask("zebra crossing statistics", today)).text).toBe(NOT_FOUND);
  });
});
