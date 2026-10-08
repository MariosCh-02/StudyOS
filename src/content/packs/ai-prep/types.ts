/**
 * Authoring types for the AI Preparation pack. Each subject is one module
 * exporting a `SubjectContent`; `index.ts` assembles them into a PackV1.
 *
 * Text fields are Markdown with $inline$ / $$block$$ LaTeX (backslashes must be
 * escaped in TS strings: "\\theta"). Lesson content may also contain:
 *   ::viz[gradient-descent]        → an interactive visualization (own line)
 *   :::hint Title                  → a collapsible hint, closed by a line ":::"
 */
import type { QuestionData, QuestionType } from "@/domain/questions";

type DataFor<T extends QuestionType> = Omit<Extract<QuestionData, { type: T }>, "type">;

interface QuestionBase {
  /** Unique within the pack; prefix with the subject key, e.g. "la-q01". */
  key: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  prompt: string;
  /** Topic key from this subject's `topics`. */
  topic: string;
  /** Lesson key this question exercises. */
  lesson: string;
  explanation: string;
  whyWrong?: string;
  example?: string;
  hint?: string;
  /** "diag" marks questions used in the 50-question diagnostic. */
  tags?: string[];
}

export type ContentQuestion = { [T in QuestionType]: QuestionBase & { type: T; data: DataFor<T> } }[QuestionType];

export interface ContentLesson {
  /** e.g. "la-01" */
  key: string;
  level: 1 | 2 | 3 | 4;
  title: string;
  summary: string;
  content: string;
  minutes: number;
  topic: string;
}

export interface SubjectContent {
  /** Short key used as a prefix for every item key, e.g. "la". */
  key: string;
  name: string;
  description: string;
  /** Keys prefixed with the subject key, e.g. "la-vectors". */
  topics: { key: string; name: string }[];
  lessons: ContentLesson[];
  questions: ContentQuestion[];
  flashcards: { key: string; topic: string; lesson?: string; front: string; back: string; tags?: string[] }[];
  formulas: { key: string; title: string; latex: string; explanation: string; variables?: { symbol: string; meaning: string }[]; example?: string; topic: string; tags?: string[] }[];
}

/** Required lesson counts per subject (StudyOS spec §61). */
export const LESSON_TARGETS: Record<string, number> = {
  la: 10,
  calc: 10,
  prob: 10,
  stats: 10,
  py: 10,
  ml: 15,
  dl: 10,
  algo: 8,
  proj: 7,
};

/** Questions per subject: at least 300 in total across the eight subjects. */
export const QUESTION_TARGETS: Record<string, number> = {
  la: 38,
  calc: 38,
  prob: 38,
  stats: 38,
  py: 38,
  ml: 50,
  dl: 40,
  algo: 30,
  proj: 0,
};

/** Questions tagged "diag" per subject: 50 in total (spec §63). */
export const DIAGNOSTIC_TARGETS: Record<string, number> = {
  la: 6,
  calc: 6,
  prob: 6,
  stats: 6,
  py: 8,
  ml: 8,
  dl: 4,
  algo: 6,
  proj: 0,
};
