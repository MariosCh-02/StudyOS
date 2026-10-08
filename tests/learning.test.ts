import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import type { DbDriver } from "../src/lib/db/driver";
import { createLesson, createSubject, createTrack, deleteTrack, listFormulas, listLessons, listTracks, createFormula, listDiagnostics, setLessonCompleted } from "../src/services/learning";
import {
  createFlashcard,
  createQuestion,
  dueCounts,
  dueQuestionIds,
  finishQuizSession,
  listFlashcards,
  listQuestions,
  listQuizSessions,
  recordAttempt,
  reviewFlashcard,
  sessionBreakdown,
  startQuizSession,
  topicMastery,
  type QuestionInput,
} from "../src/services/practice";
import { installedPackVersion, installPack, packItemId, validatePack, type PackV1 } from "../src/services/packs";
import { ValidationError } from "../src/domain/validation";

let db: DbDriver;
beforeEach(async () => {
  db = await createTestDb();
});

const question = (over: Partial<QuestionInput> = {}): QuestionInput => ({
  type: "mcq",
  prompt: "What does gradient descent follow?",
  data: { type: "mcq", choices: [{ id: "a", text: "Negative gradient", correct: true }, { id: "b", text: "Positive gradient", correct: false }] },
  explanation: null,
  whyWrong: null,
  example: null,
  hint: null,
  difficulty: 2,
  lessonId: null,
  subjectId: null,
  courseId: null,
  tags: [],
  topicName: "Gradient descent",
  ...over,
});

describe("tracks and lessons", () => {
  it("builds a track with levelled lessons and progress", async () => {
    const t = await createTrack({ title: "Organic Chemistry Preparation", description: null, color: null });
    const s = await createSubject(t, "Reactions");
    const l1 = await createLesson({ subjectId: s, level: 2, title: "Substitution", summary: null, content: "SN1 vs SN2", estimatedMinutes: 30, topicName: "Nucleophilic substitution" });
    await createLesson({ subjectId: s, level: 1, title: "Bonding", summary: null, content: "…", estimatedMinutes: null, topicName: null });
    expect((await listLessons({ trackId: t })).map((l) => l.title)).toEqual(["Bonding", "Substitution"]);
    await setLessonCompleted(l1, true);
    expect((await listTracks())[0]).toMatchObject({ lessonCount: 2, completedCount: 1, subjectCount: 1 });
    expect((await listLessons({ trackId: t }))[1]?.topicName).toBe("Nucleophilic substitution");
    await deleteTrack(t);
    expect(await listLessons()).toHaveLength(0);
  });
});

describe("questions, attempts and mastery", () => {
  it("validates question data", async () => {
    await expect(createQuestion(question({ data: { type: "mcq", choices: [{ id: "a", text: "x", correct: false }, { id: "b", text: "y", correct: false }] } }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createQuestion(question({ difficulty: 7 }))).rejects.toThrow(/1–5/);
  });

  it("records attempts, schedules reviews and computes mastery", async () => {
    const q1 = await createQuestion(question());
    const q2 = await createQuestion(question({ prompt: "Another", difficulty: 4 }));
    const s = await startQuizSession("practice", "Practice", {}, "2026-10-06T19:00");
    await recordAttempt(q1, s, 1, { selected: ["a"] }, 4000, "2026-10-06T19:01");
    await recordAttempt(q2, s, 0, { selected: ["b"] }, 9000, "2026-10-06T19:02");
    await finishQuizSession(s, "2026-10-06T19:05");
    expect((await listQuizSessions())[0]).toMatchObject({ score: 0.5, answered: 2, finishedAt: "2026-10-06T19:05" });

    // Wrong answers come back today, right ones tomorrow.
    expect(await dueQuestionIds("2026-10-06")).toEqual([q2]);
    expect((await dueQuestionIds("2026-10-07")).sort()).toEqual([q1, q2].sort());
    expect((await dueCounts("2026-10-06")).questionsDue).toBe(1);

    const m = await topicMastery("2026-10-06");
    expect(m[0]).toMatchObject({ name: "Gradient descent", attempts: 2 });
    expect(m[0]!.mastery).toBeGreaterThan(0);
    expect(m[0]!.mastery).toBeLessThan(40);

    const b = await sessionBreakdown(s);
    expect(b.byTopic).toEqual([{ key: expect.any(String), name: "Gradient descent", correct: 1, total: 2, percent: 50 }]);
  });
});

describe("flashcards", () => {
  it("reviews cards on a spaced schedule", async () => {
    const c = await createFlashcard({ front: "$\\nabla f$?", back: "Gradient", courseId: null, lessonId: null, noteId: null, subjectId: null, tags: ["exam"], topicName: "Calculus" });
    await createFlashcard({ front: "PCA?", back: "Principal components", courseId: null, lessonId: null, noteId: null, subjectId: null, tags: [], topicName: null });
    expect(await dueCounts("2026-10-06")).toMatchObject({ cardsDue: 0, cardsNew: 2 });
    const s = await reviewFlashcard(c, "good", "2026-10-06", "2026-10-06T20:00");
    expect(s.dueDate).toBe("2026-10-07");
    expect((await listFlashcards({ dueBy: "2026-10-06" })).map((x) => x.front)).toEqual(["PCA?"]);
    expect((await listFlashcards({ dueBy: "2026-10-07" })).map((x) => x.front)).toEqual(["$\\nabla f$?", "PCA?"]);
    expect(await dueCounts("2026-10-07")).toMatchObject({ cardsDue: 1, cardsNew: 1 });
    expect((await topicMastery("2026-10-06")).find((t) => t.name === "Calculus")?.reviews).toBe(1);
  });
});

const PACK: PackV1 = {
  format: 1,
  id: "test-pack",
  version: 1,
  title: "AI Preparation",
  description: "Test",
  topics: [{ key: "vectors", name: "Vectors", subject: "Linear Algebra" }],
  subjects: [{ key: "la", name: "Linear Algebra" }],
  lessons: [{ key: "la1", subject: "la", level: 1, title: "Vectors", content: "A vector $v \\in \\mathbb{R}^n$", topic: "vectors" }],
  questions: [
    { key: "q1", lesson: "la1", topic: "vectors", type: "numeric", difficulty: 1, prompt: "$\\|(3,4)\\|$ = ?", data: { answer: 5 } },
    { key: "q2", lesson: "la1", topic: "vectors", type: "mcq", difficulty: 2, prompt: "Dot product of orthogonal vectors?", data: { choices: [{ id: "a", text: "0", correct: true }, { id: "b", text: "1", correct: false }] } },
  ],
  flashcards: [{ key: "c1", lesson: "la1", topic: "vectors", front: "Unit vector?", back: "Length 1" }],
  formulas: [{ key: "f1", title: "Dot product", latex: "a \\cdot b = \\sum_i a_i b_i", topic: "vectors" }],
  diagnostics: [{ key: "d1", title: "Diagnostic", questions: ["q1", "q2"] }],
};

describe("curriculum packs", () => {
  it("rejects broken packs before writing anything", async () => {
    const broken = { ...PACK, questions: [{ ...PACK.questions[0]!, lesson: "nope" }] };
    expect(validatePack(broken)).toContain('Question q1 refers to unknown lesson "nope".');
    await expect(installPack(broken)).rejects.toThrow(/invalid/);
    expect(await listTracks()).toHaveLength(0);
  });

  it("installs, and reinstalls in place keeping progress", async () => {
    expect(await installPack(PACK)).toEqual({ lessons: 1, questions: 2, flashcards: 1, formulas: 1, diagnostics: 1 });
    expect(await installedPackVersion("test-pack")).toBe(1);
    const q1 = packItemId("test-pack", "question", "q1");
    await recordAttempt(q1, null, 1, null, null, "2026-10-06T10:00");

    const v2 = { ...PACK, version: 2, lessons: [{ ...PACK.lessons[0]!, title: "Vectors and norms" }] };
    await installPack(v2);
    expect(await listTracks()).toHaveLength(1);
    expect((await listLessons())[0]?.title).toBe("Vectors and norms");
    expect(await listQuestions()).toHaveLength(2);
    expect((await listQuestions({ subjectId: packItemId("test-pack", "subject", "la") })).length).toBe(2);
    expect(await installedPackVersion("test-pack")).toBe(2);
    const attempts = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM question_attempts WHERE question_id = $1", [q1]);
    expect(attempts[0]!.n).toBe(1);
    expect((await listFormulas())[0]?.subject).toBe("Linear Algebra");
    expect((await listDiagnostics())[0]?.questionIds).toEqual([q1, packItemId("test-pack", "question", "q2")]);
  });

  it("restores pack content the user deleted when reinstalled", async () => {
    await installPack(PACK);
    const t = (await listTracks())[0]!.id;
    await deleteTrack(t);
    await installPack(PACK);
    expect(await listLessons()).toHaveLength(1);
  });
});

describe("formulas", () => {
  it("filters by subject, course and search", async () => {
    await createFormula({ title: "Bayes", latex: "P(A|B)", explanation: null, variables: [{ symbol: "A", meaning: "event" }], example: null, subject: "Probability", courseIds: ["c1"], noteIds: [], tags: ["exam"] }, "Bayes theorem");
    await createFormula({ title: "Newton", latex: "F = ma", explanation: null, variables: [], example: null, subject: "Physics", courseIds: [], noteIds: [], tags: [] });
    expect((await listFormulas({ subject: "Physics" })).map((f) => f.title)).toEqual(["Newton"]);
    expect((await listFormulas({ courseId: "c1" })).map((f) => f.title)).toEqual(["Bayes"]);
    expect((await listFormulas({ search: "bayes theorem" })).map((f) => f.title)).toEqual(["Bayes"]);
  });
});
