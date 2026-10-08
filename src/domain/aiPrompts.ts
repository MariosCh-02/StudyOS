/**
 * Prompts for the optional AI features and parsers for their answers.
 * Pure functions: no network, database or settings access.
 */
import { validateQuestionData, type QuestionData, type QuestionType } from "./questions";

export const AI_PROVIDERS = ["none", "openai", "anthropic", "ollama"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export type RemoteProvider = Exclude<AiProvider, "none">;

export const PROVIDER_LABELS: Record<AiProvider, string> = { none: "Off", openai: "OpenAI", anthropic: "Anthropic (Claude)", ollama: "Ollama (local models)" };

/** Suggested models; any model the provider offers can be typed or listed in Settings. */
export const SUGGESTED_MODELS: Record<RemoteProvider, string[]> = {
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"],
  openai: [],
  ollama: ["llama3.2", "qwen2.5", "mistral"],
};

export interface AiPrompt {
  system: string;
  prompt: string;
  maxTokens: number;
}

const BASE_SYSTEM = [
  "You are the study assistant inside StudyOS, a student's personal study app.",
  "Write clear, accurate, concise English for a university student. Use Markdown; write maths in LaTeX with $…$ inline and $$…$$ for display equations.",
  "Never present your answer as official university, lecturer or course material, and never invent sources, page numbers or citations.",
  "If you are unsure or the material doesn't support a claim, say so plainly.",
].join(" ");

const quote = (label: string, text: string) => `<${label}>\n${text.trim()}\n</${label}>`;

/** Upper bound on text sent per request, to keep requests fast and affordable. */
export const MAX_INPUT_CHARS = 60_000;
export const clip = (s: string, max = MAX_INPUT_CHARS) => (s.length > max ? `${s.slice(0, max)}\n\n[…truncated]` : s);

export function summarizePrompt(text: string, title?: string): AiPrompt {
  return {
    system: BASE_SYSTEM,
    maxTokens: 1200,
    prompt: [
      `Summarise these study notes${title ? ` ("${title}")` : ""} for revision.`,
      "Start with a two-sentence overview, then a bullet list of the key ideas, definitions and formulas, then a short list of anything that looks unclear or incomplete in the notes.",
      "Use only what the notes say.",
      "",
      quote("notes", clip(text)),
    ].join("\n"),
  };
}

export function explainPrompt(selection: string, context?: string): AiPrompt {
  return {
    system: BASE_SYSTEM,
    maxTokens: 1500,
    prompt: [
      "Explain the selected passage to a student who is meeting it for the first time.",
      "Give: (1) the intuition in plain words, (2) a precise explanation, (3) one small worked example, (4) a common mistake to avoid.",
      context?.trim() ? "The surrounding notes are included for context only." : "",
      "",
      quote("selection", clip(selection, 20_000)),
      context?.trim() ? `\n${quote("context", clip(context, 20_000))}` : "",
    ]
      .filter((l) => l !== "")
      .join("\n"),
  };
}

export function improvePrompt(text: string): AiPrompt {
  return {
    system: BASE_SYSTEM,
    maxTokens: Math.min(8000, Math.max(800, Math.ceil(text.length / 2.5))),
    prompt: [
      "Clean up these messy study notes: fix spelling and grammar, organise them under clear headings, turn run-on text into bullet points where it helps, and format formulas in LaTeX.",
      "Keep every fact, example and question from the original. Do not add new content and do not remove anything. Mark anything that seems wrong with “(check)”.",
      "Reply with the improved notes only, in Markdown, without any preamble.",
      "",
      quote("notes", clip(text)),
    ].join("\n"),
  };
}

export function flashcardsPrompt(text: string, count: number): AiPrompt {
  return {
    system: BASE_SYSTEM,
    maxTokens: 300 + count * 220,
    prompt: [
      `Create up to ${count} flashcards from these notes for spaced-repetition review.`,
      "Each card tests one fact, definition, formula or idea. Fronts are questions or prompts; backs are short, complete answers (Markdown and LaTeX allowed).",
      "Use only what the notes say. Prefer the most important ideas.",
      'Reply with JSON only, no prose: {"cards": [{"front": "…", "back": "…"}]}',
      "",
      quote("notes", clip(text)),
    ].join("\n"),
  };
}

export function quizPrompt(text: string, count: number): AiPrompt {
  return {
    system: BASE_SYSTEM,
    maxTokens: 400 + count * 450,
    prompt: [
      `Write ${count} practice questions that test understanding of these notes, from easier to harder.`,
      "Mix these types:",
      '- "mcq": 4 options, exactly one correct; give a short reason why each wrong option is wrong.',
      '- "short": a one-word or short-phrase answer; list acceptable answers.',
      '- "numeric": a calculation with a single numeric answer.',
      '- "explain": an open question with a model answer and 2–4 key points.',
      "Every question needs an explanation of the correct answer. Use only what the notes support.",
      "Reply with JSON only, no prose, in this shape:",
      '{"questions": [',
      '  {"type": "mcq", "prompt": "…", "options": [{"text": "…", "correct": true}, {"text": "…", "correct": false, "why": "…"}], "explanation": "…", "difficulty": 2},',
      '  {"type": "short", "prompt": "…", "accepted": ["…"], "explanation": "…", "difficulty": 1},',
      '  {"type": "numeric", "prompt": "…", "answer": 0.5, "tolerance": 0.01, "explanation": "…", "difficulty": 3},',
      '  {"type": "explain", "prompt": "…", "modelAnswer": "…", "keyPoints": ["…"], "explanation": "…", "difficulty": 3}',
      "]}",
      "",
      quote("notes", clip(text)),
    ].join("\n"),
  };
}

export interface StudyPlanInput {
  today: string;
  goal: string;
  deadline: string | null;
  hoursPerWeek: number | null;
  /** Lines such as "Gradient descent — mastery 35%, last reviewed 12 days ago". */
  topics: string[];
  /** Other commitments, e.g. "Assignment 2 due 2026-11-03". */
  commitments: string[];
  notes?: string;
}

export function studyPlanPrompt(i: StudyPlanInput): AiPrompt {
  return {
    system: BASE_SYSTEM,
    maxTokens: 2500,
    prompt: [
      `Today is ${i.today}. Create a realistic revision plan for: ${i.goal}.`,
      i.deadline ? `The deadline is ${i.deadline}.` : "There is no fixed deadline; plan the next two weeks.",
      i.hoursPerWeek ? `The student can study about ${i.hoursPerWeek} hours per week.` : "",
      "Prioritise weak and long-unreviewed topics, use spaced repetition and active recall (practice questions, flashcards, past papers), and keep a buffer before the deadline.",
      "Format: a short strategy paragraph, then a day-by-day (or week-by-week if more than three weeks) Markdown checklist with topic, activity and time, then 3 tips.",
      "",
      quote("topics", i.topics.length ? i.topics.join("\n") : "No topic data recorded yet."),
      i.commitments.length ? `\n${quote("commitments", i.commitments.join("\n"))}` : "",
      i.notes?.trim() ? `\n${quote("student_notes", clip(i.notes, 4000))}` : "",
    ]
      .filter((l) => l !== "")
      .join("\n"),
  };
}

export interface PaperForPrompt {
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  abstract: string | null;
  notes: string | null;
}

export function paperSummaryPrompt(p: PaperForPrompt): AiPrompt {
  return {
    system: BASE_SYSTEM,
    maxTokens: 1500,
    prompt: [
      "Summarise this research paper for a student's literature review, using only the information below (abstract and the student's reading notes). Do not add results that are not stated.",
      "Use these headings: **Problem**, **Approach**, **Key findings**, **Limitations**, **Relevance** (how it might be used in a project). Keep it under 250 words.",
      "",
      quote(
        "paper",
        [
          `Title: ${p.title}`,
          p.authors.length ? `Authors: ${p.authors.join("; ")}` : "",
          p.year ? `Year: ${p.year}` : "",
          p.venue ? `Venue: ${p.venue}` : "",
          p.abstract ? `Abstract: ${p.abstract}` : "Abstract: (not available)",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
      p.notes?.trim() ? `\n${quote("reading_notes", clip(p.notes, 30_000))}` : "",
    ]
      .filter((l) => l !== "")
      .join("\n"),
  };
}

export interface AskSource {
  /** 1-based number used for citations like [2]. */
  n: number;
  kind: string;
  title: string;
  text: string;
}

export function askPrompt(question: string, sources: AskSource[], notFound: string): AiPrompt {
  return {
    system: `${BASE_SYSTEM} You answer questions about the student's own study data using only the numbered sources provided.`,
    maxTokens: 1000,
    prompt: [
      "Answer the question using only the sources below, which come from the student's StudyOS data. Cite sources inline as [1], [2].",
      `If the sources don't contain the answer, reply with exactly: ${notFound}`,
      "",
      `Question: ${question.trim()}`,
      "",
      ...sources.map((s) => `<source n="${s.n}" kind="${s.kind}" title="${s.title.replace(/"/g, "'")}">\n${clip(s.text, 3000).trim()}\n</source>`),
    ].join("\n"),
  };
}

// ------------------------------------------------------------------ parsing

/** The first JSON object or array in a reply (tolerates ```json fences and chatter). */
export function extractJson(reply: string): unknown {
  // A fence must start a line, so a fence inside a JSON string (e.g. a code example) doesn't end it.
  const fenced = /^```(?:json)?[ \t]*\n([\s\S]*?)\n```[ \t]*$/im.exec(reply);
  if (fenced) {
    try {
      return scanJson(fenced[1]!);
    } catch {
      // fall through to the whole reply
    }
  }
  return scanJson(reply);
}

function scanJson(text: string): unknown {
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error("The AI reply didn't contain the expected data. Try again.");
  const open = text[start]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        break;
      }
    }
  }
  throw new Error("The AI reply was cut off or malformed. Try again, perhaps with fewer items.");
}

const str = (v: unknown, max = 4000): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const arrayOf = (v: unknown, key: string): unknown[] => (Array.isArray(v) ? v : v && typeof v === "object" && Array.isArray((v as Record<string, unknown>)[key]) ? ((v as Record<string, unknown>)[key] as unknown[]) : []);

export interface CardDraft {
  front: string;
  back: string;
}

export function parseFlashcards(reply: string, max = 50): CardDraft[] {
  const seen = new Set<string>();
  const cards: CardDraft[] = [];
  for (const c of arrayOf(extractJson(reply), "cards")) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const front = str(o.front ?? o.question ?? o.q, 1000);
    const back = str(o.back ?? o.answer ?? o.a, 4000);
    if (!front || !back || seen.has(front.toLowerCase())) continue;
    seen.add(front.toLowerCase());
    cards.push({ front, back });
    if (cards.length >= max) break;
  }
  return cards;
}

export interface QuestionDraft {
  type: QuestionType;
  prompt: string;
  data: QuestionData;
  explanation: string | null;
  difficulty: number;
}

function toQuestion(o: Record<string, unknown>, k: number): QuestionDraft | null {
  const prompt = str(o.prompt ?? o.question, 4000);
  if (!prompt) return null;
  const explanation = str(o.explanation, 4000);
  const d = Number(o.difficulty);
  const difficulty = Number.isInteger(d) && d >= 1 && d <= 5 ? d : 2;
  let data: QuestionData | null = null;
  switch (o.type) {
    case "mcq": {
      const opts = arrayOf(o.options ?? o.choices, "options")
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map((x, i) => ({ id: `q${k}o${i}`, text: str(x.text, 1000) ?? "", correct: x.correct === true, ...(str(x.why, 1000) ? { why: str(x.why, 1000)! } : {}) }))
        .filter((c) => c.text);
      if (opts.filter((c) => c.correct).length === 1) data = { type: "mcq", choices: opts };
      break;
    }
    case "short": {
      const accepted = arrayOf(o.accepted ?? o.answers, "accepted").map((x) => str(x, 200)).filter((x): x is string => !!x);
      const single = str(o.answer, 200);
      if (single && !accepted.includes(single)) accepted.push(single);
      if (accepted.length) data = { type: "short", accepted };
      break;
    }
    case "numeric": {
      const answer = typeof o.answer === "number" ? o.answer : Number(o.answer);
      const tol = Number(o.tolerance);
      if (Number.isFinite(answer)) data = { type: "numeric", answer, ...(Number.isFinite(tol) && tol >= 0 ? { tolerance: tol } : {}) };
      break;
    }
    case "explain": {
      const modelAnswer = str(o.modelAnswer ?? o.answer, 4000);
      const keyPoints = arrayOf(o.keyPoints, "keyPoints").map((x) => str(x, 300)).filter((x): x is string => !!x);
      if (modelAnswer) data = { type: "explain", modelAnswer, keyPoints };
      break;
    }
  }
  if (!data || validateQuestionData(data).length) return null;
  return { type: data.type, prompt, data, explanation, difficulty };
}

/** Valid questions from a reply plus how many were dropped as unusable. */
export function parseQuestions(reply: string, max = 30): { questions: QuestionDraft[]; dropped: number } {
  const raw = arrayOf(extractJson(reply), "questions");
  const questions: QuestionDraft[] = [];
  let dropped = 0;
  raw.forEach((q, k) => {
    const parsed = q && typeof q === "object" ? toQuestion(q as Record<string, unknown>, k) : null;
    if (parsed && questions.length < max) questions.push(parsed);
    else dropped++;
  });
  return { questions, dropped };
}

/** The label put on everything AI-generated. */
export function aiLabel(provider: RemoteProvider, model: string, date: string): string {
  return `AI-generated with ${PROVIDER_LABELS[provider]} (${model}) on ${date}. Not official course material — check it against your sources.`;
}
