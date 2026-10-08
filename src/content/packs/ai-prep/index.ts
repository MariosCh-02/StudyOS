/**
 * AI Preparation curriculum pack (StudyOS spec §61–65).
 * Mathematics relevant to AI, Python/NumPy, machine learning, deep learning,
 * algorithms, and guided projects, plus a 50-question MSc diagnostic.
 */
import type { PackV1 } from "@/services/packs";
import type { SubjectContent } from "./types";
import { subject as la } from "./linear-algebra";
import { subject as calc } from "./calculus";
import { subject as prob } from "./probability";
import { subject as stats } from "./statistics";
import { subject as py } from "./python";
import { subject as ml } from "./machine-learning";
import { subject as dl } from "./deep-learning";
import { subject as algo } from "./algorithms";
import { subject as proj } from "./projects";

export const PACK_ID = "ai-prep";
export const PACK_VERSION = 1;

/** Subjects in the order they appear in the track. */
export const SUBJECTS: SubjectContent[] = [la, calc, prob, stats, py, ml, dl, algo, proj];

export function buildAiPrepPack(): PackV1 {
  const diagnostic = SUBJECTS.flatMap((s) => s.questions.filter((q) => q.tags?.includes("diag")).map((q) => q.key));
  return {
    format: 1,
    id: PACK_ID,
    version: PACK_VERSION,
    title: "AI Preparation",
    description:
      "Preparation for a Master's in Artificial Intelligence: the mathematics that matters for AI (linear algebra, calculus, probability, statistics), Python and NumPy, machine learning, deep learning, algorithms, and seven guided projects.",
    color: "#7b8ff7",
    topics: SUBJECTS.flatMap((s) => s.topics.map((t) => ({ key: t.key, name: t.name, subject: s.name }))),
    subjects: SUBJECTS.map((s) => ({ key: s.key, name: s.name, description: s.description })),
    lessons: SUBJECTS.flatMap((s) =>
      s.lessons.map((l) => ({ key: l.key, subject: s.key, level: l.level, title: l.title, summary: l.summary, content: l.content, minutes: l.minutes, topic: l.topic })),
    ),
    questions: SUBJECTS.flatMap((s) =>
      s.questions.map((q) => ({
        key: q.key,
        subject: s.key,
        lesson: q.lesson,
        topic: q.topic,
        type: q.type,
        difficulty: q.difficulty,
        prompt: q.prompt,
        data: q.data,
        explanation: q.explanation,
        whyWrong: q.whyWrong,
        example: q.example,
        hint: q.hint,
        tags: q.tags,
      })),
    ),
    flashcards: SUBJECTS.flatMap((s) => s.flashcards.map((c) => ({ key: c.key, subject: s.key, lesson: c.lesson, topic: c.topic, front: c.front, back: c.back, tags: c.tags }))),
    formulas: SUBJECTS.flatMap((s) =>
      s.formulas.map((f) => ({ key: f.key, title: f.title, latex: f.latex, explanation: f.explanation, variables: f.variables, example: f.example, subject: s.name, topic: f.topic, tags: f.tags })),
    ),
    diagnostics: diagnostic.length
      ? [
          {
            key: "msc-diagnostic",
            title: "AI MSc preparation diagnostic",
            description: "About 50 questions across mathematics, statistics, Python, algorithms and machine learning. No feedback during the test; afterwards you get your strong and weak areas and a personalised study plan.",
            questions: diagnostic,
          },
        ]
      : [],
  };
}
