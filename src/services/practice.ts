/** Question bank, quizzes, flashcards, spaced repetition and mastery. */
import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import { QUESTION_TYPES, validateQuestionData, type QuestionData, type QuestionType } from "@/domain/questions";
import { newState, ratingForScore, review, RATING_SCORE, type Rating, type SrsState } from "@/domain/srs";
import { mastery, type Evidence } from "@/domain/mastery";
import { dateOf, type DateKey } from "@/domain/time";
import { assertValid, blankToNull, requireText } from "@/domain/validation";
import { ensureTopic } from "./learning";
import { setTags } from "./tags";

const parseJson = <T,>(json: string | null, fallback: T): T => {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
};

// --------------------------------------------------------------- questions

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  data: QuestionData;
  explanation: string | null;
  whyWrong: string | null;
  example: string | null;
  hint: string | null;
  difficulty: number;
  topicId: string | null;
  topicName: string | null;
  lessonId: string | null;
  subjectId: string | null;
  courseId: string | null;
  tags: string[];
  packId: string | null;
}

export type QuestionInput = Omit<Question, "id" | "topicId" | "topicName" | "packId"> & { topicName: string | null };

interface QuestionRow {
  id: string;
  type: QuestionType;
  prompt: string;
  data: string;
  explanation: string | null;
  why_wrong: string | null;
  example: string | null;
  hint: string | null;
  difficulty: number;
  topic_id: string | null;
  topic_name: string | null;
  lesson_id: string | null;
  subject_id: string | null;
  course_id: string | null;
  tags: string;
  pack_id: string | null;
}

const mapQuestion = (r: QuestionRow): Question => ({
  id: r.id,
  type: r.type,
  prompt: r.prompt,
  data: { ...parseJson<object>(r.data, {}), type: r.type } as QuestionData,
  explanation: r.explanation,
  whyWrong: r.why_wrong,
  example: r.example,
  hint: r.hint,
  difficulty: r.difficulty,
  topicId: r.topic_id,
  topicName: r.topic_name,
  lessonId: r.lesson_id,
  subjectId: r.subject_id,
  courseId: r.course_id,
  tags: parseJson<string[]>(r.tags, []),
  packId: r.pack_id,
});

const QUESTION_SELECT = `SELECT q.*, tp.name AS topic_name FROM questions q
  LEFT JOIN topics tp ON tp.id = q.topic_id AND tp.deleted_at IS NULL WHERE q.deleted_at IS NULL`;

export interface QuestionFilter {
  topicId?: string;
  lessonId?: string;
  subjectId?: string;
  trackId?: string;
  courseId?: string;
  type?: QuestionType;
  search?: string;
  ids?: string[];
}

export async function listQuestions(filter: QuestionFilter = {}): Promise<Question[]> {
  const db = await getDb();
  const params: string[] = [];
  let sql = QUESTION_SELECT;
  const eq = (col: string, v: string | undefined) => {
    if (!v) return;
    params.push(v);
    sql += ` AND ${col} = $${params.length}`;
  };
  eq("q.topic_id", filter.topicId);
  eq("q.lesson_id", filter.lessonId);
  eq("q.subject_id", filter.subjectId);
  eq("q.course_id", filter.courseId);
  eq("q.type", filter.type);
  if (filter.trackId) {
    params.push(filter.trackId);
    sql += ` AND q.subject_id IN (SELECT id FROM subjects WHERE track_id = $${params.length} AND deleted_at IS NULL)`;
  }
  if (filter.search?.trim()) {
    params.push(`%${filter.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    sql += ` AND (q.prompt LIKE $${params.length} ESCAPE '\\' OR tp.name LIKE $${params.length} ESCAPE '\\')`;
  }
  const rows = await db.select<QuestionRow>(`${sql} ORDER BY q.subject_id, q.difficulty, q.created_at`, params);
  const list = rows.map(mapQuestion);
  if (!filter.ids) return list;
  const byId = new Map(list.map((q) => [q.id, q]));
  return filter.ids.map((id) => byId.get(id)).filter((q): q is Question => q != null);
}

export async function getQuestion(id: string): Promise<Question | null> {
  const db = await getDb();
  const rows = await db.select<QuestionRow>(`${QUESTION_SELECT} AND q.id = $1`, [id]);
  return rows[0] ? mapQuestion(rows[0]) : null;
}

function validateQuestion(input: QuestionInput) {
  const dataErrors = validateQuestionData(input.data);
  assertValid({
    prompt: requireText(input.prompt, "Question", 20000),
    type: (QUESTION_TYPES as readonly string[]).includes(input.type) && input.data.type === input.type ? undefined : "Choose a question type.",
    difficulty: Number.isInteger(input.difficulty) && input.difficulty >= 1 && input.difficulty <= 5 ? undefined : "Difficulty must be 1–5.",
    data: dataErrors[0],
  });
}

export async function createQuestion(input: QuestionInput): Promise<string> {
  validateQuestion(input);
  const topic = input.topicName?.trim() ? await ensureTopic(input.topicName) : null;
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO questions (id, type, prompt, data, explanation, why_wrong, example, hint, difficulty, topic_id, lesson_id, subject_id, course_id, tags, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
    [id, input.type, input.prompt.trim(), JSON.stringify(input.data), blankToNull(input.explanation), blankToNull(input.whyWrong), blankToNull(input.example), blankToNull(input.hint),
      input.difficulty, topic?.id ?? null, input.lessonId, input.subjectId, input.courseId, JSON.stringify(input.tags), now],
  );
  await setTags("question", id, input.tags);
  return id;
}

export async function updateQuestion(id: string, input: QuestionInput): Promise<void> {
  validateQuestion(input);
  const topic = input.topicName?.trim() ? await ensureTopic(input.topicName) : null;
  const db = await getDb();
  await db.execute(
    `UPDATE questions SET type = $2, prompt = $3, data = $4, explanation = $5, why_wrong = $6, example = $7, hint = $8, difficulty = $9, topic_id = $10,
       lesson_id = $11, subject_id = $12, course_id = $13, tags = $14, updated_at = $15 WHERE id = $1 AND deleted_at IS NULL`,
    [id, input.type, input.prompt.trim(), JSON.stringify(input.data), blankToNull(input.explanation), blankToNull(input.whyWrong), blankToNull(input.example), blankToNull(input.hint),
      input.difficulty, topic?.id ?? null, input.lessonId, input.subjectId, input.courseId, JSON.stringify(input.tags), nowIso()],
  );
  await setTags("question", id, input.tags);
}

export async function deleteQuestion(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE questions SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE srs_state SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [`question:${id}`, now]);
}

// -------------------------------------------------------------------- SRS

interface SrsRow {
  id: string;
  item_id: string;
  due_date: string;
  interval_days: number;
  ease: number;
  reps: number;
  lapses: number;
  last_review: string | null;
}

const mapSrs = (r: SrsRow): SrsState => ({ dueDate: r.due_date, intervalDays: r.interval_days, ease: r.ease, reps: r.reps, lapses: r.lapses, lastReview: r.last_review });

export async function getSrs(type: "card" | "question", itemId: string, today: DateKey): Promise<SrsState> {
  const db = await getDb();
  const rows = await db.select<SrsRow>("SELECT * FROM srs_state WHERE id = $1 AND deleted_at IS NULL", [`${type}:${itemId}`]);
  return rows[0] ? mapSrs(rows[0]) : newState(today);
}

async function saveSrs(type: "card" | "question", itemId: string, s: SrsState): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute(
    `INSERT INTO srs_state (id, item_type, item_id, due_date, interval_days, ease, reps, lapses, last_review, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     ON CONFLICT (id) DO UPDATE SET due_date = excluded.due_date, interval_days = excluded.interval_days, ease = excluded.ease, reps = excluded.reps,
       lapses = excluded.lapses, last_review = excluded.last_review, updated_at = excluded.updated_at, deleted_at = NULL`,
    [`${type}:${itemId}`, type, itemId, s.dueDate, s.intervalDays, s.ease, s.reps, s.lapses, s.lastReview, now],
  );
}

// ------------------------------------------------------- quiz & attempts

export type QuizKind = "practice" | "diagnostic" | "lesson" | "review" | "exam";

export interface QuizSessionSummary {
  id: string;
  kind: QuizKind;
  title: string;
  startedAt: string;
  finishedAt: string | null;
  score: number | null;
  answered: number;
  config: Record<string, unknown>;
}

export async function startQuizSession(kind: QuizKind, title: string, config: Record<string, unknown>, startedAt: string): Promise<string> {
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute("INSERT INTO quiz_sessions (id, kind, title, config, started_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)", [
    id,
    kind,
    title,
    JSON.stringify(config),
    startedAt,
    now,
  ]);
  return id;
}

export async function finishQuizSession(id: string, finishedAt: string): Promise<void> {
  const db = await getDb();
  const agg = await db.select<{ n: number; avg: number | null }>("SELECT COUNT(*) AS n, AVG(score) AS avg FROM question_attempts WHERE session_id = $1 AND deleted_at IS NULL", [id]);
  await db.execute("UPDATE quiz_sessions SET finished_at = $2, score = $3, answered = $4, updated_at = $5 WHERE id = $1", [id, finishedAt, agg[0]?.avg ?? null, agg[0]?.n ?? 0, nowIso()]);
}

export async function listQuizSessions(limit = 50): Promise<QuizSessionSummary[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; kind: QuizKind; title: string; started_at: string; finished_at: string | null; score: number | null; answered: number; config: string }>(
    "SELECT * FROM quiz_sessions WHERE deleted_at IS NULL ORDER BY started_at DESC LIMIT $1",
    [limit],
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, startedAt: r.started_at, finishedAt: r.finished_at, score: r.score, answered: r.answered, config: parseJson(r.config, {}) }));
}

/** Stores an answer and reschedules the question for spaced review. */
export async function recordAttempt(questionId: string, sessionId: string | null, score: number, response: unknown, timeMs: number | null, answeredAt: string): Promise<void> {
  if (!(score >= 0 && score <= 1)) throw new Error("Score must be between 0 and 1.");
  const db = await getDb();
  const now = nowIso();
  await db.execute(
    "INSERT INTO question_attempts (id, question_id, session_id, answered_at, score, response, time_ms, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)",
    [newId(), questionId, sessionId, answeredAt, score, JSON.stringify(response ?? null), timeMs, now],
  );
  const today = dateOf(answeredAt);
  await saveSrs("question", questionId, review(await getSrs("question", questionId, today), ratingForScore(score), today));
}

export interface AttemptRow {
  questionId: string;
  sessionId: string | null;
  answeredAt: string;
  score: number;
}

export async function listAttempts(filter: { sessionId?: string; questionId?: string } = {}): Promise<AttemptRow[]> {
  const db = await getDb();
  const params: string[] = [];
  let sql = "SELECT question_id, session_id, answered_at, score FROM question_attempts WHERE deleted_at IS NULL";
  if (filter.sessionId) {
    params.push(filter.sessionId);
    sql += ` AND session_id = $${params.length}`;
  }
  if (filter.questionId) {
    params.push(filter.questionId);
    sql += ` AND question_id = $${params.length}`;
  }
  const rows = await db.select<{ question_id: string; session_id: string | null; answered_at: string; score: number }>(`${sql} ORDER BY answered_at`, params);
  return rows.map((r) => ({ questionId: r.question_id, sessionId: r.session_id, answeredAt: r.answered_at, score: r.score }));
}

/** Questions scheduled for review today or earlier (only those answered before). */
export async function dueQuestionIds(today: DateKey): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ item_id: string }>(
    `SELECT s.item_id FROM srs_state s JOIN questions q ON q.id = s.item_id AND q.deleted_at IS NULL
     WHERE s.item_type = 'question' AND s.deleted_at IS NULL AND s.due_date <= $1 ORDER BY s.due_date`,
    [today],
  );
  return rows.map((r) => r.item_id);
}

// -------------------------------------------------------------- flashcards

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  courseId: string | null;
  topicId: string | null;
  topicName: string | null;
  lessonId: string | null;
  noteId: string | null;
  subjectId: string | null;
  tags: string[];
  /** Null for cards never reviewed. */
  dueDate: string | null;
  intervalDays: number | null;
  /** Full schedule, or null for new cards. */
  srs: SrsState | null;
}

export type FlashcardInput = Pick<Flashcard, "front" | "back" | "courseId" | "lessonId" | "noteId" | "subjectId" | "tags"> & { topicName: string | null };

interface CardRow {
  id: string;
  front: string;
  back: string;
  course_id: string | null;
  topic_id: string | null;
  topic_name: string | null;
  lesson_id: string | null;
  note_id: string | null;
  subject_id: string | null;
  tags: string;
  due_date: string | null;
  interval_days: number | null;
  ease: number | null;
  reps: number | null;
  lapses: number | null;
  last_review: string | null;
}

const mapCard = (r: CardRow): Flashcard => ({
  id: r.id,
  front: r.front,
  back: r.back,
  courseId: r.course_id,
  topicId: r.topic_id,
  topicName: r.topic_name,
  lessonId: r.lesson_id,
  noteId: r.note_id,
  subjectId: r.subject_id,
  tags: parseJson<string[]>(r.tags, []),
  dueDate: r.due_date,
  intervalDays: r.interval_days,
  srs:
    r.due_date != null
      ? { dueDate: r.due_date, intervalDays: r.interval_days ?? 0, ease: r.ease ?? 2.5, reps: r.reps ?? 0, lapses: r.lapses ?? 0, lastReview: r.last_review }
      : null,
});

const CARD_SELECT = `SELECT f.*, tp.name AS topic_name, s.due_date, s.interval_days, s.ease, s.reps, s.lapses, s.last_review FROM flashcards f
  LEFT JOIN topics tp ON tp.id = f.topic_id AND tp.deleted_at IS NULL
  LEFT JOIN srs_state s ON s.id = 'card:' || f.id AND s.deleted_at IS NULL
  WHERE f.deleted_at IS NULL`;

export interface CardFilter {
  courseId?: string;
  topicId?: string;
  lessonId?: string;
  subjectId?: string;
  noteId?: string;
  search?: string;
  /** Only cards due by this date (including new cards). */
  dueBy?: DateKey;
}

export async function listFlashcards(filter: CardFilter = {}): Promise<Flashcard[]> {
  const db = await getDb();
  const params: string[] = [];
  let sql = CARD_SELECT;
  const eq = (col: string, v: string | undefined) => {
    if (!v) return;
    params.push(v);
    sql += ` AND ${col} = $${params.length}`;
  };
  eq("f.course_id", filter.courseId);
  eq("f.topic_id", filter.topicId);
  eq("f.lesson_id", filter.lessonId);
  eq("f.subject_id", filter.subjectId);
  eq("f.note_id", filter.noteId);
  if (filter.search?.trim()) {
    params.push(`%${filter.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    sql += ` AND (f.front LIKE $${params.length} ESCAPE '\\' OR f.back LIKE $${params.length} ESCAPE '\\')`;
  }
  if (filter.dueBy) {
    params.push(filter.dueBy);
    sql += ` AND (s.due_date IS NULL OR s.due_date <= $${params.length})`;
  }
  // Overdue first, then new cards, then the rest.
  const rows = await db.select<CardRow>(`${sql} ORDER BY s.due_date IS NULL, s.due_date, f.created_at`, params);
  return rows.map(mapCard);
}

function validateCard(input: FlashcardInput) {
  assertValid({ front: requireText(input.front, "Front", 10000), back: requireText(input.back, "Back", 10000) });
}

export async function createFlashcard(input: FlashcardInput): Promise<string> {
  validateCard(input);
  const topic = input.topicName?.trim() ? await ensureTopic(input.topicName) : null;
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO flashcards (id, front, back, course_id, topic_id, lesson_id, note_id, subject_id, tags, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
    [id, input.front.trim(), input.back.trim(), input.courseId, topic?.id ?? null, input.lessonId, input.noteId, input.subjectId, JSON.stringify(input.tags), now],
  );
  await setTags("flashcard", id, input.tags);
  return id;
}

export async function updateFlashcard(id: string, input: FlashcardInput): Promise<void> {
  validateCard(input);
  const topic = input.topicName?.trim() ? await ensureTopic(input.topicName) : null;
  const db = await getDb();
  await db.execute(
    `UPDATE flashcards SET front = $2, back = $3, course_id = $4, topic_id = $5, lesson_id = $6, note_id = $7, subject_id = $8, tags = $9, updated_at = $10
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, input.front.trim(), input.back.trim(), input.courseId, topic?.id ?? null, input.lessonId, input.noteId, input.subjectId, JSON.stringify(input.tags), nowIso()],
  );
  await setTags("flashcard", id, input.tags);
}

export async function deleteFlashcard(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE flashcards SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE srs_state SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [`card:${id}`, now]);
}

/** Records a review and returns the new schedule. */
export async function reviewFlashcard(cardId: string, rating: Rating, today: DateKey, reviewedAt: string): Promise<SrsState> {
  const next = review(await getSrs("card", cardId, today), rating, today);
  await saveSrs("card", cardId, next);
  const db = await getDb();
  const now = nowIso();
  await db.execute("INSERT INTO flashcard_reviews (id, card_id, reviewed_at, rating, interval_days, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)", [
    newId(),
    cardId,
    reviewedAt,
    rating,
    next.intervalDays,
    now,
  ]);
  return next;
}

export interface DueCounts {
  cardsDue: number;
  cardsNew: number;
  questionsDue: number;
}

export async function dueCounts(today: DateKey): Promise<DueCounts> {
  const db = await getDb();
  const [cards, questions] = await Promise.all([
    db.select<{ due: number; fresh: number }>(
      `SELECT SUM(CASE WHEN s.id IS NOT NULL AND s.due_date <= $1 THEN 1 ELSE 0 END) AS due,
              SUM(CASE WHEN s.id IS NULL THEN 1 ELSE 0 END) AS fresh
       FROM flashcards f LEFT JOIN srs_state s ON s.id = 'card:' || f.id AND s.deleted_at IS NULL WHERE f.deleted_at IS NULL`,
      [today],
    ),
    dueQuestionIds(today),
  ]);
  return { cardsDue: cards[0]?.due ?? 0, cardsNew: cards[0]?.fresh ?? 0, questionsDue: questions.length };
}

// ----------------------------------------------------------------- mastery

export interface TopicMastery {
  topicId: string;
  name: string;
  subject: string | null;
  mastery: number | null;
  attempts: number;
  reviews: number;
}

/** Mastery per topic from question attempts and flashcard reviews. */
export async function topicMastery(today: DateKey): Promise<TopicMastery[]> {
  const db = await getDb();
  const [topics, attempts, reviews] = await Promise.all([
    db.select<{ id: string; name: string; subject: string | null }>("SELECT id, name, subject FROM topics WHERE deleted_at IS NULL"),
    db.select<{ topic_id: string; score: number; answered_at: string; difficulty: number }>(
      `SELECT q.topic_id, a.score, a.answered_at, q.difficulty FROM question_attempts a JOIN questions q ON q.id = a.question_id
       WHERE a.deleted_at IS NULL AND q.topic_id IS NOT NULL`,
    ),
    db.select<{ topic_id: string; rating: Rating; reviewed_at: string }>(
      `SELECT f.topic_id, r.rating, r.reviewed_at FROM flashcard_reviews r JOIN flashcards f ON f.id = r.card_id
       WHERE r.deleted_at IS NULL AND f.topic_id IS NOT NULL`,
    ),
  ]);
  const evidence = new Map<string, { list: Evidence[]; attempts: number; reviews: number }>();
  const bucket = (id: string) => evidence.get(id) ?? evidence.set(id, { list: [], attempts: 0, reviews: 0 }).get(id)!;
  for (const a of attempts) {
    const b = bucket(a.topic_id);
    b.list.push({ score: a.score, date: dateOf(a.answered_at), difficulty: a.difficulty });
    b.attempts++;
  }
  for (const r of reviews) {
    const b = bucket(r.topic_id);
    b.list.push({ score: RATING_SCORE[r.rating], date: dateOf(r.reviewed_at), difficulty: 2 });
    b.reviews++;
  }
  return topics
    .map((t) => {
      const b = evidence.get(t.id);
      return { topicId: t.id, name: t.name, subject: t.subject, mastery: b ? mastery(b.list, today) : null, attempts: b?.attempts ?? 0, reviews: b?.reviews ?? 0 };
    })
    .sort((a, b) => (a.mastery ?? -1) - (b.mastery ?? -1) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------- diagnostic results

export interface AreaScore {
  key: string;
  name: string;
  correct: number;
  total: number;
  percent: number;
}

/** Scores of a finished session grouped by subject and by topic. */
export async function sessionBreakdown(sessionId: string): Promise<{ bySubject: AreaScore[]; byTopic: AreaScore[] }> {
  const db = await getDb();
  const rows = await db.select<{ score: number; subject_id: string | null; subject_name: string | null; topic_id: string | null; topic_name: string | null }>(
    `SELECT a.score, q.subject_id, s.name AS subject_name, q.topic_id, tp.name AS topic_name
     FROM question_attempts a JOIN questions q ON q.id = a.question_id
     LEFT JOIN subjects s ON s.id = q.subject_id LEFT JOIN topics tp ON tp.id = q.topic_id
     WHERE a.session_id = $1 AND a.deleted_at IS NULL`,
    [sessionId],
  );
  const group = (key: (r: (typeof rows)[number]) => [string, string]) => {
    const m = new Map<string, AreaScore>();
    for (const r of rows) {
      const [k, name] = key(r);
      const g = m.get(k) ?? { key: k, name, correct: 0, total: 0, percent: 0 };
      g.correct += r.score;
      g.total += 1;
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, percent: (g.correct / g.total) * 100 })).sort((a, b) => a.percent - b.percent);
  };
  return {
    bySubject: group((r) => [r.subject_id ?? "none", r.subject_name ?? "Other"]),
    byTopic: group((r) => [r.topic_id ?? "none", r.topic_name ?? "Untagged"]),
  };
}
