import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import { scaleFromPreset } from "../src/domain/grading";
import {
  aiLabel,
  askPrompt,
  extractJson,
  flashcardsPrompt,
  improvePrompt,
  parseFlashcards,
  parseQuestions,
  quizPrompt,
  studyPlanPrompt,
  summarizePrompt,
  MAX_INPUT_CHARS,
} from "../src/domain/aiPrompts";
import { docToMarkdown, markdownToNodes, parseInline } from "../src/domain/noteMarkdown";
import type { DocNode } from "../src/domain/noteContent";
import { getAllSettings, setSetting } from "../src/services/settings";
import {
  aiAsk,
  aiExamPlan,
  aiFlashcards,
  aiQuestions,
  aiSummarize,
  getAiConfig,
  keywords,
  retrieve,
  saveAiFlashcards,
  saveAiQuestions,
  setAiTransport,
  AI_TAG,
} from "../src/services/ai";
import type { AiCompletionRequest } from "../src/lib/native";
import { createInstitution } from "../src/services/institutions";
import { createProgramme } from "../src/services/programmes";
import { createCourse } from "../src/services/courses";
import { createNote, saveNote } from "../src/services/notes";
import { createExam } from "../src/services/assessments";
import { listFlashcards, listQuestions } from "../src/services/practice";
import { NOT_FOUND } from "../src/services/ask";

const doc = (text: string) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("note ↔ Markdown", () => {
  it("serialises headings, lists, marks, code and maths", () => {
    const d: DocNode = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Gradient descent" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Update " },
            { type: "inlineMath", attrs: { latex: "\\theta \\leftarrow \\theta - \\alpha g" } },
            { type: "text", text: " with ", marks: [] },
            { type: "text", text: "small", marks: [{ type: "bold" }] },
            { type: "text", text: " steps" },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "convex" }] }] }] },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }] }] },
        { type: "codeBlock", attrs: { language: "python" }, content: [{ type: "text", text: "x = 1\ny = 2" }] },
        { type: "blockMath", attrs: { latex: "J(\\theta)" } },
      ],
    };
    expect(docToMarkdown(d)).toBe(
      "## Gradient descent\n\nUpdate $\\theta \\leftarrow \\theta - \\alpha g$ with **small** steps\n\n- convex\n\n- [x] done\n\n```python\nx = 1\ny = 2\n```\n\n$$J(\\theta)$$",
    );
  });

  it("parses Markdown answers into editor nodes", () => {
    const nodes = markdownToNodes(
      "# Title\n\nSome **bold** and *italic* with `code` and $x^2$.\n\n- one\n- two\n  continued\n\n1. first\n2. second\n\n- [ ] todo\n\n> quoted\n\n```py\nprint(1)\n```\n\n$$\na+b\n$$\n\n---\nend [link](https://example.com)",
    );
    expect(nodes.map((n) => n.type)).toEqual(["heading", "paragraph", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "blockMath", "horizontalRule", "paragraph"]);
    expect(nodes[1]!.content!.map((n) => n.type === "text" ? `${n.text}${n.marks ? `:${n.marks.map((m) => m.type).join("+")}` : ""}` : n.type)).toEqual([
      "Some ",
      "bold:bold",
      " and ",
      "italic:italic",
      " with ",
      "code:code",
      " and ",
      "inlineMath",
      ".",
    ]);
    expect(nodes[2]!.content).toHaveLength(2);
    expect(JSON.stringify(nodes[2]!.content![1])).toContain("continued");
    expect(nodes[4]!.content![0]!.attrs).toEqual({ checked: false });
    expect(nodes[6]!.attrs).toEqual({ language: "py" });
    expect(nodes[7]!.attrs).toEqual({ latex: "a+b" });
    expect(nodes[9]!.content![1]!.marks).toEqual([{ type: "link", attrs: { href: "https://example.com" } }]);
    // only http(s) links become links
    expect(parseInline("[x](javascript:alert(1))").every((n) => !n.marks)).toBe(true);
  });

  it("round-trips its own output", () => {
    const md = "## A\n\nText with $e^x$ and **b**.\n\n- x\n- y";
    expect(docToMarkdown({ type: "doc", content: markdownToNodes(md) })).toBe(md);
  });
});

describe("prompts and parsing", () => {
  it("builds prompts that keep the material and the rules", () => {
    const s = summarizePrompt("Backprop uses the chain rule.", "Lecture 4");
    expect(s.system).toMatch(/Never present your answer as official/);
    expect(s.prompt).toContain("<notes>\nBackprop uses the chain rule.\n</notes>");
    expect(flashcardsPrompt("x", 7).prompt).toContain("up to 7 flashcards");
    expect(quizPrompt("x", 4).prompt).toContain('"type": "mcq"');
    expect(improvePrompt("a".repeat(MAX_INPUT_CHARS + 10)).prompt).toContain("[…truncated]");
    const plan = studyPlanPrompt({ today: "2026-10-07", goal: "ML exam", deadline: "2026-11-01", hoursPerWeek: 10, topics: ["SVMs — mastery 30%"], commitments: [] });
    expect(plan.prompt).toContain("SVMs — mastery 30%");
    expect(plan.prompt).toContain("10 hours per week");
    const ask = askPrompt("When?", [{ n: 1, kind: "Notes", title: 'My "note"', text: "Exam is on Monday" }], NOT_FOUND);
    expect(ask.prompt).toContain(`<source n="1" kind="Notes" title="My 'note'">\nExam is on Monday\n</source>`);
    expect(ask.prompt).toContain(NOT_FOUND);
  });

  it("extracts JSON from fenced or chatty replies", () => {
    expect(extractJson('Sure!\n```json\n{"cards": []}\n```')).toEqual({ cards: [] });
    expect(extractJson('Here: [{"a": "b ] }"}] hope it helps')).toEqual([{ a: "b ] }" }]);
    expect(() => extractJson("no json here")).toThrow(/expected data/);
    expect(() => extractJson('{"cards": [{"front": "x"')).toThrow(/cut off/);
  });

  it("parses flashcards, dropping blanks and duplicates", () => {
    const cards = parseFlashcards('{"cards": [{"front": "What is SGD?", "back": "Stochastic gradient descent"}, {"front": "what is sgd?", "back": "dup"}, {"front": "", "back": "x"}, {"question": "Q2", "answer": "A2"}]}');
    expect(cards).toEqual([
      { front: "What is SGD?", back: "Stochastic gradient descent" },
      { front: "Q2", back: "A2" },
    ]);
  });

  it("parses and validates questions", () => {
    const reply = JSON.stringify({
      questions: [
        { type: "mcq", prompt: "2+2?", options: [{ text: "4", correct: true }, { text: "5", correct: false, why: "off by one" }], explanation: "Arithmetic", difficulty: 1 },
        { type: "mcq", prompt: "bad", options: [{ text: "a", correct: true }, { text: "b", correct: true }] },
        { type: "short", prompt: "Capital of Cyprus?", accepted: ["Nicosia"], answer: "Lefkosia" },
        { type: "numeric", prompt: "1/4 as decimal?", answer: "0.25", tolerance: 0.001, difficulty: 9 },
        { type: "explain", prompt: "Why regularise?", modelAnswer: "To reduce overfitting.", keyPoints: ["variance"] },
        { type: "coding", prompt: "unsupported" },
      ],
    });
    const { questions, dropped } = parseQuestions(reply);
    expect(dropped).toBe(2);
    expect(questions.map((q) => q.type)).toEqual(["mcq", "short", "numeric", "explain"]);
    expect(questions[0]!.data).toMatchObject({ type: "mcq", choices: [{ text: "4", correct: true }, { text: "5", correct: false, why: "off by one" }] });
    expect(questions[1]!.data).toEqual({ type: "short", accepted: ["Nicosia", "Lefkosia"] });
    expect(questions[2]).toMatchObject({ data: { type: "numeric", answer: 0.25, tolerance: 0.001 }, difficulty: 2 });
  });

  it("labels generated content", () => {
    expect(aiLabel("anthropic", "claude-opus-5-5", "7 Oct 2026")).toBe(
      "AI-generated with Anthropic (Claude) (claude-opus-5-5) on 7 Oct 2026. Not official course material — check it against your sources.",
    );
  });

  it("extracts question keywords", () => {
    expect(keywords("What did I write about gradient descent?")).toEqual(["write", "gradient", "descent"]);
  });
});

describe("AI service", () => {
  let calls: AiCompletionRequest[];
  let reply: string;
  let courseId: string;

  beforeEach(async () => {
    await createTestDb();
    calls = [];
    reply = "ok";
    setAiTransport(async (req) => {
      calls.push(req);
      return { text: reply, truncated: false };
    });
    const i = await createInstitution({ name: "UCY", kind: "university", country: null, website: null, notes: null });
    const p = await createProgramme({ institutionId: i.id, name: "MSc AI", level: "master", status: "active", field: null, startDate: null, endDate: null, totalCredits: 90, creditUnit: "ECTS", gradingScale: scaleFromPreset("ten_point"), targetGrade: null, color: null, notes: null });
    courseId = (await createCourse({ programmeId: p.id, semesterId: null, name: "Machine Learning", code: "MAI611", credits: 10, lecturer: null, lecturerEmail: null, location: null, status: "in_progress", finalGrade: null, targetGrade: null, color: null, description: null })).id;
  });
  afterEach(() => setAiTransport(null));

  it("is off by default and validates settings", async () => {
    expect(await getAiConfig()).toBeNull();
    await expect(aiSummarize("text")).rejects.toThrow(/Turn on AI/);
    expect(calls).toHaveLength(0);
    await expect(setSetting("aiOllamaUrl", "file:///c:/x")).rejects.toThrow();
    await expect(setSetting("aiModel", "two words")).rejects.toThrow();
    await setSetting("aiProvider", "anthropic");
    expect(await getAiConfig()).toBeNull(); // no model yet
    await setSetting("aiModel", "claude-opus-5-5");
    expect(await getAiConfig()).toEqual({ provider: "anthropic", model: "claude-opus-5-5", baseUrl: null });
    expect((await getAllSettings()).aiOllamaUrl).toBe("http://localhost:11434");
  });

  describe("when configured", () => {
    beforeEach(async () => {
      await setSetting("aiProvider", "ollama");
      await setSetting("aiModel", "llama3.2");
    });

    it("sends only the requested text and labels the result", async () => {
      reply = "  Summary.  ";
      const r = await aiSummarize("Overfitting notes", "W3");
      expect(r.text).toBe("Summary.");
      expect(r.label).toMatch(/^AI-generated with Ollama \(local models\) \(llama3\.2\) on /);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ provider: "ollama", model: "llama3.2", baseUrl: "http://localhost:11434" });
      expect(calls[0]!.prompt).toContain("Overfitting notes");
      await expect(aiSummarize("   ")).rejects.toThrow(/no note text/);
      expect(calls).toHaveLength(1);
    });

    it("generates and saves tagged flashcards and questions", async () => {
      reply = '{"cards": [{"front": "Bias?", "back": "Error from wrong assumptions"}]}';
      const { cards, label } = await aiFlashcards("bias and variance", 5);
      await saveAiFlashcards(cards, { courseId, topicName: "Bias-variance" });
      const saved = await listFlashcards({ courseId });
      expect(saved).toHaveLength(1);
      expect(saved[0]!.tags).toEqual([AI_TAG]);

      reply = '{"questions": [{"type": "short", "prompt": "Opposite of bias?", "accepted": ["variance"], "explanation": "Trade-off"}]}';
      const q = await aiQuestions("bias and variance", 3);
      await saveAiQuestions(q.questions, { courseId }, label);
      const qs = await listQuestions({ courseId });
      expect(qs).toHaveLength(1);
      expect(qs[0]!.tags).toEqual([AI_TAG]);
      expect(qs[0]!.explanation).toContain("AI-generated with");

      reply = "no json";
      await expect(aiFlashcards("x")).rejects.toThrow(/expected data/);
    });

    it("plans revision from exam topics and course mastery", async () => {
      const exam = await createExam({
        courseId,
        title: "Final",
        kind: "final",
        startAt: "2026-12-10T09:00",
        durationMinutes: 120,
        location: null,
        topics: [{ id: "t1", text: "Kernels", done: false }, { id: "t2", text: "Trees", done: true }],
        notes: null,
        weight: 60,
        score: null,
        maxScore: null,
      });
      reply = "- [ ] Day 1";
      await aiExamPlan(exam.id, { hoursPerWeek: 8 }, "2026-11-20");
      expect(calls[0]!.prompt).toContain("Kernels — not revised yet");
      expect(calls[0]!.prompt).toContain("Trees — marked as revised");
      expect(calls[0]!.prompt).toContain("The deadline is 2026-12-10");
    });

    it("answers from retrieved notes with sources, and never calls AI without sources", async () => {
      const n = await createNote({ courseId, title: "Optimisation" });
      await saveNote(n.id, "Optimisation", doc("Gradient descent uses a learning rate of 0.01 in our lab."));
      expect((await retrieve("what learning rate did we use for gradient descent")).map((r) => r.id)).toContain(n.id);

      reply = "You used 0.01 [1].";
      const a = await aiAsk("What learning rate did we use in gradient descent?");
      expect(a).toMatchObject({ found: true, usedAi: true, text: "You used 0.01 [1]." });
      expect(a.items[0]).toMatchObject({ label: "[1] Optimisation", href: `/notes/${n.id}` });
      expect(calls[0]!.prompt).toContain("learning rate of 0.01");

      reply = NOT_FOUND;
      expect(await aiAsk("What learning rate for gradient descent?")).toMatchObject({ found: false, text: NOT_FOUND, items: [] });

      const before = calls.length;
      expect(await aiAsk("Tell me about quantum chromodynamics")).toMatchObject({ found: false, usedAi: false, text: NOT_FOUND });
      expect(calls.length).toBe(before);
    });

    it("answers structured questions from the database without AI", async () => {
      await createExam({ courseId, title: "Machine Learning Final", kind: "final", startAt: "2099-01-15T09:00", durationMinutes: 120, location: "Room 1", topics: [], notes: null, weight: null, score: null, maxScore: null });
      const a = await aiAsk("When is my Machine Learning exam?");
      expect(a.usedAi).toBe(false);
      expect(a.text).toContain("Machine Learning Final");
      expect(calls).toHaveLength(0);
    });
  });
});
