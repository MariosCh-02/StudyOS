/**
 * Quality gate for the AI Preparation content pack.
 * Run one subject with:  npx vitest run tests/content.test.ts -t "subject la"
 */
import { describe, expect, it } from "vitest";
import katex from "katex";
import { buildAiPrepPack, SUBJECTS } from "../src/content/packs/ai-prep";
import { DIAGNOSTIC_TARGETS, LESSON_TARGETS, QUESTION_TARGETS, type SubjectContent } from "../src/content/packs/ai-prep/types";
import { validateQuestionData, type QuestionData } from "../src/domain/questions";
import { mathSegments } from "../src/lib/markdown";
import { validatePack } from "../src/services/packs";
import { VIZ_IDS } from "../src/features/visualizations/catalog";

// Control characters (other than \n) mean a backslash was not escaped, e.g. "\theta" → TAB + "heta".
const CONTROL = /[\u0000-\u0009\u000b-\u001f]/;

function walkStrings(value: unknown, path: string, out: { path: string; text: string }[]) {
  if (typeof value === "string") out.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walkStrings(v, `${path}.${k}`, out);
}

/** Markdown fields of a subject (where $…$ is maths). */
function markdownFields(s: SubjectContent): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const l of s.lessons) out.push({ where: `lesson ${l.key}`, text: l.content });
  for (const q of s.questions) {
    for (const [k, v] of Object.entries({ prompt: q.prompt, explanation: q.explanation, whyWrong: q.whyWrong, example: q.example, hint: q.hint })) if (v) out.push({ where: `question ${q.key}.${k}`, text: v });
    if (q.type === "mcq") for (const c of q.data.choices) out.push({ where: `question ${q.key} choice ${c.id}`, text: `${c.text} ${c.why ?? ""}` });
    if (q.type === "explain") out.push({ where: `question ${q.key}.modelAnswer`, text: q.data.modelAnswer });
  }
  for (const c of s.flashcards) out.push({ where: `flashcard ${c.key}`, text: `${c.front}\n\n${c.back}` });
  for (const f of s.formulas) out.push({ where: `formula ${f.key}`, text: `${f.explanation}\n\n${f.example ?? ""}` });
  return out;
}

const katexError = (tex: string, display: boolean): string | null => {
  try {
    katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: "ignore", trust: false });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};

for (const s of SUBJECTS) {
  const isProjects = s.key === "proj";
  describe(`subject ${s.key}`, () => {
    it("has the required number of lessons across levels", () => {
      expect(s.lessons.length).toBe(LESSON_TARGETS[s.key]);
      const levels = new Set(s.lessons.map((l) => l.level));
      expect(levels.size).toBeGreaterThanOrEqual(isProjects ? 2 : 3);
    });

    it("uses unique, prefixed keys and valid references", () => {
      const keys = [...s.topics, ...s.lessons, ...s.questions, ...s.flashcards, ...s.formulas].map((x) => x.key);
      const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
      expect(dupes, "duplicate keys").toEqual([]);
      expect(keys.filter((k) => !k.startsWith(`${s.key}-`)), "keys must start with the subject prefix").toEqual([]);
      const topics = new Set(s.topics.map((t) => t.key));
      const lessons = new Set(s.lessons.map((l) => l.key));
      const bad = [
        ...s.lessons.filter((l) => !topics.has(l.topic)).map((l) => `lesson ${l.key} topic ${l.topic}`),
        ...s.questions.filter((q) => !topics.has(q.topic)).map((q) => `question ${q.key} topic ${q.topic}`),
        ...s.questions.filter((q) => !lessons.has(q.lesson)).map((q) => `question ${q.key} lesson ${q.lesson}`),
        ...s.flashcards.filter((c) => !topics.has(c.topic) || (c.lesson && !lessons.has(c.lesson))).map((c) => `flashcard ${c.key}`),
        ...s.formulas.filter((f) => !topics.has(f.topic)).map((f) => `formula ${f.key}`),
      ];
      expect(bad, "unknown references").toEqual([]);
    });

    it("has enough well-formed questions", () => {
      expect(s.questions.length).toBeGreaterThanOrEqual(QUESTION_TARGETS[s.key]!);
      const invalid = s.questions.flatMap((q) => validateQuestionData({ ...q.data, type: q.type } as QuestionData).map((e) => `${q.key}: ${e}`));
      expect(invalid).toEqual([]);
      expect(s.questions.filter((q) => !q.explanation.trim()).map((q) => q.key), "every question needs an explanation").toEqual([]);
      if (!isProjects) {
        const perLesson = new Map(s.lessons.map((l) => [l.key, 0]));
        for (const q of s.questions) perLesson.set(q.lesson, (perLesson.get(q.lesson) ?? 0) + 1);
        expect([...perLesson].filter(([, n]) => n < 2).map(([k]) => k), "each lesson needs at least 2 exercises").toEqual([]);
        expect(new Set(s.questions.map((q) => q.type)).size, "use at least 4 question types").toBeGreaterThanOrEqual(4);
        const diag = s.questions.filter((q) => q.tags?.includes("diag"));
        expect(diag.length, "diagnostic questions").toBe(DIAGNOSTIC_TARGETS[s.key]);
        expect(diag.every((q) => q.type !== "explain" && q.type !== "coding"), "diagnostic questions must be auto-graded").toBe(true);
      }
      if (s.key === "py" || s.key === "algo") {
        const types = new Set(s.questions.map((q) => q.type));
        expect(types.has("coding") && types.has("predict") && types.has("debugging")).toBe(true);
      }
    });

    it("has substantive lessons, flashcards and formulas", () => {
      const short = s.lessons.filter((l) => l.content.length < (isProjects ? 1500 : 1200)).map((l) => `${l.key} (${l.content.length} chars)`);
      expect(short, "lesson content too short").toEqual([]);
      if (!isProjects) expect(s.flashcards.length).toBeGreaterThanOrEqual(10);
      if (["la", "calc", "prob", "stats", "ml", "dl"].includes(s.key)) expect(s.formulas.length).toBeGreaterThanOrEqual(5);
    });

    it("contains no unescaped backslashes", () => {
      const strings: { path: string; text: string }[] = [];
      walkStrings(s, s.key, strings);
      expect(strings.filter((x) => CONTROL.test(x.text)).map((x) => x.path)).toEqual([]);
    });

    it("renders every formula with KaTeX", () => {
      const errors: string[] = [];
      for (const { where, text } of markdownFields(s)) {
        for (const m of mathSegments(text)) {
          const e = katexError(m.tex, m.display);
          if (e) errors.push(`${where}: ${m.tex.slice(0, 60)} → ${e.slice(0, 80)}`);
        }
      }
      for (const f of s.formulas) {
        const e = katexError(f.latex, true);
        if (e) errors.push(`formula ${f.key}: ${e.slice(0, 80)}`);
        for (const v of f.variables ?? []) if (katexError(v.symbol, false)) errors.push(`formula ${f.key} variable ${v.symbol}`);
      }
      expect(errors).toEqual([]);
    });

    it("uses known visualizations and balanced hint blocks", () => {
      const problems: string[] = [];
      for (const l of s.lessons) {
        for (const m of l.content.matchAll(/^::viz\[([^\]]+)\]\s*$/gm)) if (!VIZ_IDS.has(m[1]!)) problems.push(`${l.key}: unknown viz ${m[1]}`);
        let open = false;
        for (const line of l.content.split("\n")) {
          if (/^:::hint\b/.test(line)) {
            if (open) problems.push(`${l.key}: nested hint`);
            open = true;
          } else if (line.trim() === ":::") {
            if (!open) problems.push(`${l.key}: stray :::`);
            open = false;
          }
        }
        if (open) problems.push(`${l.key}: unclosed hint`);
      }
      expect(problems).toEqual([]);
    });
  });
}

describe("whole pack", () => {
  it("is a valid pack with 300+ questions and a 50-question diagnostic", () => {
    const pack = buildAiPrepPack();
    expect(validatePack(pack)).toEqual([]);
    expect(pack.lessons.length).toBe(Object.values(LESSON_TARGETS).reduce((a, b) => a + b, 0));
    expect(pack.questions.length).toBeGreaterThanOrEqual(300);
    expect(pack.diagnostics[0]?.questions.length).toBe(50);
  });
});

import { createTestDb } from "./testDb";
import { installPack } from "../src/services/packs";
import { listLessons, listDiagnostics } from "../src/services/learning";
import { listQuestions } from "../src/services/practice";

describe("installing the AI Preparation pack", () => {
  it("installs into the database and reinstalls in place", async () => {
    await createTestDb();
    const pack = buildAiPrepPack();
    const r = await installPack(pack);
    expect(r.lessons).toBe(pack.lessons.length);
    expect((await listLessons()).length).toBe(pack.lessons.length);
    expect((await listQuestions()).length).toBe(pack.questions.length);
    const diag = (await listDiagnostics())[0]!;
    expect((await listQuestions({ ids: diag.questionIds })).length).toBe(50);
    await installPack(pack);
    expect((await listQuestions()).length).toBe(pack.questions.length);
  }, 60_000);
});
