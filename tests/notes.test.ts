import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import type { DbDriver } from "../src/lib/db/driver";
import { scaleFromPreset } from "../src/domain/grading";
import { docToText, fillTemplate, lectureTemplateDoc, LECTURE_TEMPLATE_SECTIONS, parseDoc } from "../src/domain/noteContent";
import { createInstitution } from "../src/services/institutions";
import { createProgramme, deleteProgramme } from "../src/services/programmes";
import { createCourse, deleteCourse } from "../src/services/courses";
import {
  createLecture,
  deleteLecture,
  getOrCreateTodaysLecture,
  listLectures,
  listLecturesOn,
  setRevisionStatus,
  updateLecture,
} from "../src/services/lectures";
import {
  clearDraft,
  createNote,
  deleteNote,
  getNote,
  getOrCreateLectureNote,
  getRecoverableDraft,
  listNotes,
  moveNote,
  saveDraft,
  saveNote,
  setNotePinned,
} from "../src/services/notes";
import { addAttachment, deleteAttachment, listAttachments, listContextPdfs, setAttachmentSlides } from "../src/services/attachments";
import { createTemplate, deleteTemplate, listTemplates } from "../src/services/templates";
import { ValidationError } from "../src/domain/validation";

let db: DbDriver;
let courseId: string;
let programmeId: string;

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
    totalCredits: null,
    creditUnit: "ECTS",
    gradingScale: scaleFromPreset("ten_point"),
    targetGrade: null,
    color: null,
    notes: null,
  });
  programmeId = p.id;
  const c = await createCourse({
    programmeId: p.id,
    semesterId: null,
    name: "Machine Learning",
    code: null,
    credits: 10,
    lecturer: "Dr. Smith",
    lecturerEmail: null,
    location: null,
    status: "in_progress",
    finalGrade: null,
    targetGrade: null,
    color: null,
    description: null,
  });
  courseId = c.id;
});

const lecture = (over = {}) => ({
  courseId,
  number: 1,
  title: "Introduction to Machine Learning",
  date: "2026-10-06",
  startTime: "17:00",
  lecturer: null,
  links: [],
  comments: null,
  revisionStatus: "not_reviewed" as const,
  ...over,
});

const pdf = (name = "slides.pdf") => ({
  storedName: `${crypto.randomUUID()}.pdf`,
  fileName: name,
  mimeType: "application/pdf",
  sizeBytes: 1234,
});

describe("note content helpers", () => {
  it("builds the spec's lecture template", () => {
    const doc = lectureTemplateDoc(3, "Gradient Descent");
    const text = docToText(doc).split("\n");
    expect(text[0]).toBe("Lecture 3 — Gradient Descent");
    expect(text.slice(1)).toEqual(LECTURE_TEMPLATE_SECTIONS);
  });

  it("extracts text including math and tables", () => {
    const doc = parseDoc(
      JSON.stringify({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Update rule " }, { type: "inlineMath", attrs: { latex: "\\theta" } }] },
          { type: "blockMath", attrs: { latex: "a^2+b^2=c^2" } },
          { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }] }] },
        ],
      }),
    );
    expect(docToText(doc)).toBe("Update rule \\theta\na^2+b^2=c^2\nx");
  });

  it("fills template placeholders and tolerates bad JSON", () => {
    const filled = fillTemplate({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "{{course}}: {{title}} {{x}}" }] }] }, {
      course: "ML",
      title: "Intro",
    });
    expect(docToText(filled)).toBe("ML: Intro {{x}}");
    expect(parseDoc("not json")).toEqual({ type: "doc", content: [] });
  });
});

describe("lectures", () => {
  it("creates, lists in order and validates", async () => {
    await createLecture(lecture({ number: 2, title: "Linear Regression" }));
    await createLecture(lecture());
    expect((await listLectures(courseId)).map((l) => l.number)).toEqual([1, 2]);
    await expect(createLecture(lecture({ title: " " }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createLecture(lecture({ startTime: "25:00" }))).rejects.toThrow(/HH:MM/);
    await expect(createLecture(lecture({ links: [{ label: "x", url: "javascript:alert(1)" }] }))).rejects.toThrow(/valid link/);
  });

  it("stores links and revision status", async () => {
    const l = await createLecture(lecture({ links: [{ label: " Slides ", url: "https://example.org/s.pdf" }] }));
    expect(l.links).toEqual([{ label: "Slides", url: "https://example.org/s.pdf" }]);
    await setRevisionStatus(l.id, "needs_review");
    const updated = await updateLecture(l.id, { ...lecture(), revisionStatus: "mastered" });
    expect(updated.revisionStatus).toBe("mastered");
  });

  it("finds or creates today's lecture with the next number", async () => {
    await createLecture(lecture({ number: 4, date: "2026-10-01" }));
    const today = await getOrCreateTodaysLecture(courseId, "2026-10-08");
    expect(today).toMatchObject({ number: 5, title: "Lecture 5", date: "2026-10-08", lecturer: "Dr. Smith" });
    expect((await getOrCreateTodaysLecture(courseId, "2026-10-08")).id).toBe(today.id);
    expect((await listLecturesOn("2026-10-08")).map((l) => l.courseName)).toEqual(["Machine Learning"]);
  });
});

describe("notes", () => {
  it("creates lecture notes from the template once", async () => {
    const l = await createLecture(lecture());
    const n1 = await getOrCreateLectureNote(l);
    const n2 = await getOrCreateLectureNote(l);
    expect(n2.id).toBe(n1.id);
    expect(n1.courseId).toBe(courseId);
    expect(n1.title).toBe("Lecture 1 — Introduction to Machine Learning");
    expect(n1.contentText).toContain("Things I Don't Understand");
  });

  it("saves content, derives plain text and searches", async () => {
    const n = await createNote({ courseId, title: "Scratch" });
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Gradient descent minimises loss" }] }] };
    await saveNote(n.id, "Optimisation", JSON.stringify(doc));
    const saved = await getNote(n.id);
    expect(saved?.title).toBe("Optimisation");
    expect(saved?.contentText).toBe("Gradient descent minimises loss");
    expect((await listNotes({ search: "DESCENT" })).map((x) => x.id)).toEqual([n.id]);
    expect(await listNotes({ search: "100%" })).toHaveLength(0); // wildcards are escaped
    expect((await listNotes({ courseId }))[0]?.snippet).toContain("Gradient");
  });

  it("orders pinned notes first and can move notes", async () => {
    const a = await createNote({ title: "A" });
    const b = await createNote({ title: "B" });
    await setNotePinned(a.id, true);
    expect((await listNotes()).map((n) => n.id)).toEqual([a.id, b.id]);
    await moveNote(b.id, courseId);
    expect((await listNotes({ courseId })).map((n) => n.id)).toEqual([b.id]);
  });

  it("rejects saving a deleted note", async () => {
    const n = await createNote();
    await deleteNote(n.id);
    await expect(saveNote(n.id, "x", "{}")).rejects.toThrow(/no longer exists/);
  });
});

describe("crash recovery drafts", () => {
  it("offers a draft that differs from the saved note", async () => {
    const n = await createNote({ title: "Lecture" });
    const unsaved = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "typed before crash" }] }] });
    await saveDraft(n.id, "Lecture", unsaved);
    const draft = await getRecoverableDraft((await getNote(n.id))!);
    expect(draft?.content).toBe(unsaved);
  });

  it("drops drafts that match what was saved", async () => {
    const n = await createNote({ title: "Lecture" });
    const content = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] });
    await saveDraft(n.id, "Lecture", content);
    await saveNote(n.id, "Lecture", content);
    expect(await getRecoverableDraft((await getNote(n.id))!)).toBeNull();
  });

  it("clearDraft keeps a newer draft", async () => {
    const n = await createNote();
    await saveDraft(n.id, "", "newer");
    await clearDraft(n.id, "older");
    const rows = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM note_drafts");
    expect(rows[0]!.n).toBe(1);
    await clearDraft(n.id, "newer");
    expect((await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM note_drafts"))[0]!.n).toBe(0);
  });
});

describe("attachments and templates", () => {
  it("lists note, then lecture (slides first), then course PDFs", async () => {
    const l = await createLecture(lecture());
    const coursePdf = await addAttachment({ type: "course", id: courseId }, pdf("syllabus.pdf"));
    await addAttachment({ type: "lecture", id: l.id }, pdf("extra.pdf"));
    const slides = await addAttachment({ type: "lecture", id: l.id }, pdf("slides.pdf"));
    await setAttachmentSlides(slides.id, true);
    await addAttachment({ type: "lecture", id: l.id }, { ...pdf("photo.png"), mimeType: "image/png" });
    const n = await createNote({ lectureId: l.id });
    await addAttachment({ type: "note", id: n.id }, pdf("handout.pdf"));
    expect((await listContextPdfs({ noteId: n.id, lectureId: l.id, courseId })).map((a) => a.fileName)).toEqual([
      "handout.pdf",
      "slides.pdf",
      "extra.pdf",
      "syllabus.pdf",
    ]);
    expect((await listContextPdfs({ courseId })).map((a) => a.fileName)).toEqual(["syllabus.pdf"]);
    await deleteAttachment(coursePdf.id);
    expect(await listAttachments({ type: "course", id: courseId })).toHaveLength(0);
  });

  it("cascades lecture, course and programme deletion", async () => {
    const l = await createLecture(lecture());
    const note = await getOrCreateLectureNote(l);
    await addAttachment({ type: "note", id: note.id }, pdf());
    await addAttachment({ type: "lecture", id: l.id }, pdf());
    await deleteLecture(l.id);
    expect(await listNotes()).toHaveLength(0);
    expect(await listAttachments({ type: "lecture", id: l.id })).toHaveLength(0);
    expect(await listAttachments({ type: "note", id: note.id })).toHaveLength(0);

    const l2 = await createLecture(lecture());
    await getOrCreateLectureNote(l2);
    await createNote({ courseId, title: "course note" });
    await addAttachment({ type: "course", id: courseId }, pdf());
    await deleteCourse(courseId);
    expect(await listNotes()).toHaveLength(0);
    expect(await listLectures(courseId)).toHaveLength(0);
    expect(await listAttachments({ type: "course", id: courseId })).toHaveLength(0);

    await createNote({ title: "loose note" });
    await deleteProgramme(programmeId);
    expect((await listNotes()).map((n) => n.title)).toEqual(["loose note"]);
  });

  it("manages custom templates", async () => {
    const t = await createTemplate("Seminar", lectureTemplateDoc(null, "{{title}}"));
    expect((await listTemplates()).map((x) => x.name)).toEqual(["Seminar"]);
    expect(docToText(parseDoc(t.content))).toContain("{{title}}");
    await deleteTemplate(t.id);
    expect(await listTemplates()).toHaveLength(0);
    await expect(createTemplate("", lectureTemplateDoc(1, "x"))).rejects.toThrow();
  });
});
