/**
 * Optional AI features. StudyOS works fully without them: nothing here runs
 * unless the user picks a provider in Settings and starts an AI action, and
 * only the text for that action is sent.
 */
import { getDb } from "@/lib/db";
import { aiComplete, type AiCompletionRequest, type AiReply } from "@/lib/native";
import {
  aiLabel,
  askPrompt,
  explainPrompt,
  flashcardsPrompt,
  improvePrompt,
  paperSummaryPrompt,
  parseFlashcards,
  parseQuestions,
  quizPrompt,
  studyPlanPrompt,
  summarizePrompt,
  type AiPrompt,
  type AskSource,
  type CardDraft,
  type QuestionDraft,
  type RemoteProvider,
} from "@/domain/aiPrompts";
import { formatDate, toDateKey } from "@/domain/dates";
import { dateOf, nowLocal, type DateKey } from "@/domain/time";
import { getAllSettings } from "./settings";
import { createFlashcard, createQuestion, topicMastery } from "./practice";
import { getExam, listAssignments } from "./assessments";
import { ask, NOT_FOUND, type Answer } from "./ask";
import { resultHref, search, SEARCH_TYPE_LABELS, type SearchResult } from "./search";

export const AI_TAG = "ai-generated";

export interface AiConfig {
  provider: RemoteProvider;
  model: string;
  baseUrl: string | null;
}

/** The configured provider, or null when AI is off or no model is chosen. */
export async function getAiConfig(): Promise<AiConfig | null> {
  const s = await getAllSettings();
  if (s.aiProvider === "none" || !s.aiModel.trim()) return null;
  return { provider: s.aiProvider, model: s.aiModel.trim(), baseUrl: s.aiProvider === "ollama" ? s.aiOllamaUrl : null };
}

/** Sends one prompt. Swappable in tests. */
export type Transport = (req: AiCompletionRequest) => Promise<AiReply>;
let transport: Transport = aiComplete;
export const setAiTransport = (t: Transport | null) => {
  transport = t ?? aiComplete;
};

export interface AiResult {
  text: string;
  truncated: boolean;
  /** Human-readable "AI-generated with … — check it" label to show and store with the result. */
  label: string;
}

async function run(p: AiPrompt): Promise<AiResult> {
  const cfg = await getAiConfig();
  if (!cfg) throw new Error("Turn on AI in Settings → AI and choose a model first.");
  const reply = await transport({ provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl, system: p.system, prompt: p.prompt, maxTokens: p.maxTokens });
  return { text: reply.text.trim(), truncated: reply.truncated, label: aiLabel(cfg.provider, cfg.model, formatDate(toDateKey(new Date()))) };
}

const requireText = (text: string, what = "text") => {
  if (!text.trim()) throw new Error(`There is no ${what} to send.`);
};

export async function aiSummarize(text: string, title?: string): Promise<AiResult> {
  requireText(text, "note text");
  return run(summarizePrompt(text, title));
}

export async function aiExplain(selection: string, context?: string): Promise<AiResult> {
  requireText(selection, "selected text");
  return run(explainPrompt(selection, context));
}

export async function aiImprove(text: string): Promise<AiResult> {
  requireText(text, "note text");
  return run(improvePrompt(text));
}

export async function aiFlashcards(text: string, count = 10): Promise<{ cards: CardDraft[]; label: string; truncated: boolean }> {
  requireText(text, "note text");
  const r = await run(flashcardsPrompt(text, count));
  const cards = parseFlashcards(r.text, count);
  if (!cards.length) throw new Error("The AI didn't return any usable flashcards. Try again or select more text.");
  return { cards, label: r.label, truncated: r.truncated };
}

export async function aiQuestions(text: string, count = 6): Promise<{ questions: QuestionDraft[]; dropped: number; label: string }> {
  requireText(text, "note text");
  const r = await run(quizPrompt(text, count));
  const { questions, dropped } = parseQuestions(r.text, count);
  if (!questions.length) throw new Error("The AI didn't return any usable questions. Try again or select more text.");
  return { questions, dropped, label: r.label };
}

export interface SaveContext {
  courseId: string | null;
  noteId?: string | null;
  lessonId?: string | null;
  topicName?: string | null;
}

/** Saves reviewed AI flashcards, tagged "ai-generated". Returns their ids. */
export async function saveAiFlashcards(cards: CardDraft[], ctx: SaveContext): Promise<string[]> {
  const ids: string[] = [];
  for (const c of cards) {
    ids.push(
      await createFlashcard({ front: c.front, back: c.back, courseId: ctx.courseId, noteId: ctx.noteId ?? null, lessonId: ctx.lessonId ?? null, subjectId: null, tags: [AI_TAG], topicName: ctx.topicName ?? null }),
    );
  }
  return ids;
}

/** Saves reviewed AI questions to the question bank, tagged "ai-generated". */
export async function saveAiQuestions(questions: QuestionDraft[], ctx: SaveContext, label: string): Promise<string[]> {
  const ids: string[] = [];
  for (const q of questions) {
    ids.push(
      await createQuestion({
        type: q.type,
        prompt: q.prompt,
        data: q.data,
        explanation: q.explanation ? `${q.explanation}\n\n*${label}*` : `*${label}*`,
        whyWrong: null,
        example: null,
        hint: null,
        difficulty: q.difficulty,
        lessonId: ctx.lessonId ?? null,
        subjectId: null,
        courseId: ctx.courseId,
        tags: [AI_TAG],
        topicName: ctx.topicName ?? null,
      }),
    );
  }
  return ids;
}

// ------------------------------------------------------------- study plan

/** A revision plan for an exam from its topics checklist, course mastery and other deadlines. */
export async function aiExamPlan(examId: string, opts: { hoursPerWeek: number | null; notes?: string }, today: DateKey = dateOf(nowLocal())): Promise<AiResult> {
  const exam = await getExam(examId);
  if (!exam) throw new Error("Exam not found.");
  const db = await getDb();
  const courseTopics = new Set(
    (
      await db.select<{ topic_id: string }>(
        `SELECT topic_id FROM questions WHERE course_id = $1 AND topic_id IS NOT NULL AND deleted_at IS NULL
         UNION SELECT topic_id FROM flashcards WHERE course_id = $1 AND topic_id IS NOT NULL AND deleted_at IS NULL`,
        [exam.courseId],
      )
    ).map((r) => r.topic_id),
  );
  const mastery = (await topicMastery(today)).filter((t) => courseTopics.has(t.topicId));
  const topics = [
    ...exam.topics.map((t) => `${t.text} — ${t.done ? "marked as revised" : "not revised yet"} (exam topic list)`),
    ...mastery.map((m) => `${m.name} — ${m.mastery == null ? "not practised yet" : `mastery ${Math.round(m.mastery * 100)}%`} (${m.attempts} answers, ${m.reviews} card reviews)`),
  ];
  const commitments = (await listAssignments({ open: true }))
    .filter((a) => a.dueAt && dateOf(a.dueAt) >= today && (!exam.startAt || a.dueAt < exam.startAt))
    .slice(0, 15)
    .map((a) => `${a.title} (${a.courseName}) due ${dateOf(a.dueAt!)}`);
  return run(
    studyPlanPrompt({
      today,
      goal: `the exam "${exam.title}" of the student's course`,
      deadline: exam.startAt ? dateOf(exam.startAt) : null,
      hoursPerWeek: opts.hoursPerWeek,
      topics,
      commitments,
      notes: opts.notes,
    }),
  );
}

// --------------------------------------------------------------- papers

export async function aiPaperSummary(p: { title: string; authors: string[]; year: number | null; venue: string | null; abstract: string | null }, readingNotes: string | null): Promise<AiResult> {
  if (!p.abstract?.trim() && !readingNotes?.trim()) throw new Error("Add the abstract or some reading notes first; the summary is based only on those.");
  return run(paperSummaryPrompt({ ...p, notes: readingNotes }));
}

// ------------------------------------------------------- Ask My Studies

const STOP = new Set(
  "a an the of to in on for and or is are was were be been what which who whom when where why how did do does i my me we our you your about with from that this these those it its as at by can could should would will have has had any all some show tell find list everything".split(
    " ",
  ),
);

/** Keywords of a question (stop words removed). */
export function keywords(question: string): string[] {
  return [...new Set(question.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 8);
}

/** Finds the stored items most relevant to a question. */
export async function retrieve(question: string, limit = 8): Promise<SearchResult[]> {
  const terms = keywords(question);
  if (!terms.length) return [];
  const all = await search(terms.join(" "), { limit });
  if (all.length < limit) {
    // Fall back to items matching any keyword, ranked by how many they match.
    const seen = new Map(all.map((r) => [`${r.type}:${r.id}`, { r, hits: terms.length }]));
    for (const t of terms) {
      for (const r of await search(t, { limit: 20 })) {
        const k = `${r.type}:${r.id}`;
        const cur = seen.get(k);
        if (cur) cur.hits++;
        else seen.set(k, { r, hits: 1 });
      }
    }
    return [...seen.values()]
      .sort((a, b) => b.hits - a.hits || b.r.score - a.r.score)
      .slice(0, limit)
      .map((x) => x.r);
  }
  return all;
}

async function sourceText(r: SearchResult): Promise<string> {
  const db = await getDb();
  const body = await db.select<{ body: string }>(
    "SELECT i.body FROM search_index i JOIN search_docs d ON d.id = i.rowid WHERE d.entity_type = $1 AND d.entity_id = $2",
    [r.type, r.id],
  );
  return body[0]?.body?.trim() || r.snippet.replace(/\[\[|\]\]/g, "");
}

/**
 * Ask My Studies with AI: questions about dates, grades and deadlines are
 * still answered exactly from the database; everything else is answered by
 * the model from the most relevant stored items, with numbered sources.
 */
export async function aiAsk(question: string, today?: DateKey): Promise<Answer & { label?: string; usedAi: boolean }> {
  const local = await ask(question, today);
  if (local.found && local.intent !== "search" && local.intent !== "wroteAbout") return { ...local, usedAi: false };
  const hits = await retrieve(question);
  if (!hits.length) return { found: false, text: NOT_FOUND, items: [], intent: local.intent, usedAi: false };
  const sources: AskSource[] = [];
  for (const [i, r] of hits.entries()) sources.push({ n: i + 1, kind: SEARCH_TYPE_LABELS[r.type], title: r.title || "Untitled", text: await sourceText(r) });
  const result = await run(askPrompt(question, sources, NOT_FOUND));
  const found = !result.text.includes(NOT_FOUND);
  const items = await Promise.all(hits.map(async (r, i) => ({ label: `[${i + 1}] ${r.title || "Untitled"}`, detail: `${SEARCH_TYPE_LABELS[r.type]}`, href: await resultHref(r) })));
  return { found, text: found ? result.text : NOT_FOUND, items: found ? items : [], intent: local.intent, label: result.label, usedAi: true };
}

/** A tiny request to check the provider, model and key work. */
export async function aiTestConnection(): Promise<string> {
  const r = await run({ system: "You are a connection test.", prompt: "Reply with the single word: OK", maxTokens: 1000 }); // headroom for reasoning models
  return r.text;
}
