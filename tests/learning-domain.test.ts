import { describe, expect, it } from "vitest";
import { newState, previewIntervals, ratingForScore, review } from "../src/domain/srs";
import { correctAnswerText, grade, normaliseOutput, parseNumber, validateQuestionData, whyWrongForResponse, emptyData, type QuestionData } from "../src/domain/questions";
import { mastery, masteryBand, pickNext, similarQuestion, startAdaptive, updateLevel } from "../src/domain/mastery";
import { renderMarkdown } from "../src/lib/markdown";

describe("spaced repetition", () => {
  const today = "2026-10-06";

  it("schedules new cards", () => {
    const s = newState(today);
    expect(previewIntervals(s, today)).toEqual({ again: 0, hard: 1, good: 1, easy: 4 });
    expect(review(s, "again", today).dueDate).toBe(today);
  });

  it("grows intervals with good answers and resets on lapses", () => {
    let s = review(newState(today), "good", today); // 1 day
    s = review(s, "good", "2026-10-07"); // 1 × 2.5 → 3 (min +1)
    expect(s.intervalDays).toBe(3);
    s = review(s, "good", "2026-10-10"); // 3 × 2.5 = 7.5 → 8
    expect(s.intervalDays).toBe(8);
    expect(s.dueDate).toBe("2026-10-18");
    const lapsed = review(s, "again", "2026-10-18");
    expect(lapsed).toMatchObject({ intervalDays: 1, lapses: 1, ease: 2.3 });
    const easy = review(s, "easy", "2026-10-18");
    expect(easy.intervalDays).toBeGreaterThan(review(s, "good", "2026-10-18").intervalDays);
    expect(review(s, "hard", "2026-10-18").intervalDays).toBeLessThan(review(s, "good", "2026-10-18").intervalDays);
  });

  it("never lets ease drop below 1.3 and maps quiz scores to ratings", () => {
    let s = review(review(newState(today), "good", today), "good", "2026-10-07");
    for (let i = 0; i < 10; i++) s = review(s, "again", today);
    expect(s.ease).toBe(1.3);
    expect([ratingForScore(1), ratingForScore(0.5), ratingForScore(0)]).toEqual(["good", "hard", "again"]);
  });
});

describe("question grading", () => {
  const mcq: QuestionData = {
    type: "mcq",
    choices: [
      { id: "a", text: "Gradient", correct: true },
      { id: "b", text: "Hessian", correct: false, why: "The Hessian holds second derivatives." },
      { id: "c", text: "Jacobian", correct: false },
    ],
  };

  it("grades single and multi-answer multiple choice with option-specific feedback", () => {
    expect(grade(mcq, { type: "mcq", selected: ["a"] })).toEqual({ status: "correct", score: 1 });
    expect(grade(mcq, { type: "mcq", selected: ["b"] })).toEqual({ status: "incorrect", score: 0 });
    expect(whyWrongForResponse(mcq, { type: "mcq", selected: ["b"] })).toEqual(["The Hessian holds second derivatives."]);
    const multi: QuestionData = { type: "mcq", multiple: true, choices: [{ id: "a", text: "x", correct: true }, { id: "b", text: "y", correct: true }, { id: "c", text: "z", correct: false }] };
    expect(grade(multi, { type: "mcq", selected: ["a"] })).toEqual({ status: "partial", score: 0.5 });
    expect(grade(multi, { type: "mcq", selected: ["a", "c"] })).toEqual({ status: "incorrect", score: 0 });
  });

  it("grades numbers with tolerance and flexible input", () => {
    const q: QuestionData = { type: "numeric", answer: 0.75, tolerance: 0.01 };
    for (const v of ["0.75", "0,75", "3/4", "0.755", " .75 "]) expect(grade(q, { type: "numeric", value: v }).status).toBe("correct");
    expect(grade(q, { type: "numeric", value: "0.8" }).status).toBe("incorrect");
    expect(grade(q, { type: "numeric", value: "abc" }).status).toBe("incorrect");
    expect(parseNumber("45%")).toBe(45);
    expect(grade({ type: "numeric", answer: 1e-9 }, { type: "numeric", value: "1e-9" }).status).toBe("correct");
  });

  it("grades short answers, output prediction and matching", () => {
    expect(grade({ type: "short", accepted: ["Overfitting"] }, { type: "short", text: "  overfitting. " }).status).toBe("correct");
    expect(grade({ type: "predict", code: "print(1)", language: "python", output: "[1, 2]\n" }, { type: "predict", text: "[1, 2]  \n\n" }).status).toBe("correct");
    expect(normaliseOutput("a \r\nb\n\n")).toBe("a\nb");
    const m: QuestionData = { type: "matching", pairs: [{ left: "PCA", right: "dimensionality" }, { left: "KNN", right: "neighbours" }, { left: "SVM", right: "margin" }] };
    expect(grade(m, { type: "matching", matches: { 0: 0, 1: 1, 2: 2 } })).toEqual({ status: "correct", score: 1 });
    expect(grade(m, { type: "matching", matches: { 0: 0, 1: 2, 2: 1 } })).toEqual({ status: "partial", score: 1 / 3 });
  });

  it("asks for self-assessment where code would need running", () => {
    expect(grade({ type: "coding", language: "python", solution: "x" }, { type: "coding", code: "y" })).toEqual({ status: "self" });
    expect(grade({ type: "explain", modelAnswer: "x", keyPoints: [] }, { type: "explain", text: "y" })).toEqual({ status: "self" });
    const dbg: QuestionData = { type: "debugging", language: "python", code: "...", choices: [{ id: "a", text: "off by one", correct: true }, { id: "b", text: "typo", correct: false }] };
    expect(grade(dbg, { type: "debugging", selected: ["a"] }).status).toBe("correct");
  });

  it("validates question data and formats answers", () => {
    expect(validateQuestionData(emptyData("mcq"))).toContain("Options can't be empty.");
    expect(validateQuestionData(emptyData("numeric"))).toContain("Enter the numerical answer.");
    expect(validateQuestionData(mcq)).toEqual([]);
    expect(correctAnswerText({ type: "numeric", answer: 9.81, unit: "m/s²", tolerance: 0.01 })).toBe("9.81 m/s² (± 0.01)");
  });
});

describe("mastery", () => {
  const today = "2026-10-06";
  const e = (score: number, date = today, difficulty = 3) => ({ score, date, difficulty });

  it("needs evidence before calling a topic mastered", () => {
    expect(mastery([], today)).toBeNull();
    expect(mastery([e(1)], today)!).toBeLessThan(30);
    const many = mastery(Array.from({ length: 12 }, () => e(1)), today)!;
    expect(many).toBeGreaterThanOrEqual(90);
    expect(masteryBand(many)).toBe("mastered");
  });

  it("weights recent results and fades old ones", () => {
    const improving = [...Array.from({ length: 6 }, () => e(0, "2026-09-01")), ...Array.from({ length: 6 }, () => e(1, "2026-10-05"))];
    const declining = [...Array.from({ length: 6 }, () => e(1, "2026-09-01")), ...Array.from({ length: 6 }, () => e(0, "2026-10-05"))];
    expect(mastery(improving, today)!).toBeGreaterThan(mastery(declining, today)!);
    expect(mastery([e(1, "2025-10-06"), e(1, "2025-10-06"), e(1, "2025-10-06")], today)!).toBeLessThan(mastery([e(1), e(1), e(1)], today)!);
  });
});

describe("adaptive selection", () => {
  const pool = [
    { id: "easy", difficulty: 1, topicId: "t1" },
    { id: "mid", difficulty: 3, topicId: "t1" },
    { id: "hard", difficulty: 5, topicId: "t2" },
    { id: "mid-weak", difficulty: 3, topicId: "t2" },
  ];
  const noRandom = () => 0;

  it("matches difficulty to level and prefers weak topics", () => {
    const m = new Map<string, number | null>([["t1", 95], ["t2", 10]]);
    expect(pickNext(pool, startAdaptive(3), m, new Set(), noRandom)?.id).toBe("mid-weak");
    expect(pickNext(pool, startAdaptive(1), new Map(), new Set(), noRandom)?.id).toBe("easy");
  });

  it("moves the level with answers and finds similar questions", () => {
    let s = startAdaptive(3);
    s = updateLevel(s, 1);
    s = updateLevel(s, 1);
    expect(s.level).toBe(4);
    s = updateLevel(s, 0);
    expect(s.level).toBe(3.25);
    expect(updateLevel(startAdaptive(1), 0).level).toBe(1);
    expect(similarQuestion(pool, pool[0]!, new Set())?.id).toBe("mid");
    expect(similarQuestion(pool, pool[0]!, new Set(["mid"]))).toBeNull();
  });
});

describe("markdown rendering", () => {
  it("renders LaTeX and leaves code alone", () => {
    const html = renderMarkdown("Update: $\\theta - \\alpha$ and `cost $5`\n\n$$\\nabla J$$");
    expect(html).toContain("katex");
    expect(html).toContain("<code>cost $5</code>");
    expect(html).toContain("katex-display");
  });

  it("escapes raw HTML and highlights code", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
    expect(renderMarkdown("```python\nimport numpy as np\n```")).toContain("hljs-keyword");
    expect(renderMarkdown("costs \\$5 and $3")).toContain("$5");
  });
});
