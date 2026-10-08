/**
 * Curriculum packs: bundled learning content (tracks, lessons, questions,
 * flashcards, formulas, diagnostics) installed into the database.
 *
 * Every item gets a stable id derived from the pack id and the item key, so
 * reinstalling or upgrading a pack updates content in place, keeps the
 * learner's progress (attempts and review schedules point at the same ids),
 * and installs identically on every synced device.
 */
import { getDb } from "@/lib/db";
import { nowIso } from "@/lib/ids";
import { QUESTION_TYPES, validateQuestionData, type QuestionData, type QuestionType } from "@/domain/questions";

export interface PackV1 {
  format: 1;
  id: string;
  version: number;
  title: string;
  description: string;
  color?: string;
  topics: { key: string; name: string; subject?: string }[];
  subjects: { key: string; name: string; description?: string }[];
  lessons: { key: string; subject: string; level: 1 | 2 | 3 | 4; title: string; summary?: string; content: string; minutes?: number; topic?: string }[];
  questions: {
    key: string;
    subject?: string;
    lesson?: string;
    topic?: string;
    type: QuestionType;
    difficulty: number;
    prompt: string;
    data: Omit<QuestionData, "type">;
    explanation?: string;
    whyWrong?: string;
    example?: string;
    hint?: string;
    tags?: string[];
  }[];
  flashcards: { key: string; subject?: string; lesson?: string; topic?: string; front: string; back: string; tags?: string[] }[];
  formulas: { key: string; title: string; latex: string; explanation?: string; variables?: { symbol: string; meaning: string }[]; example?: string; subject?: string; topic?: string; tags?: string[] }[];
  diagnostics: { key: string; title: string; description?: string; questions: string[] }[];
}

export const packItemId = (packId: string, kind: string, key: string) => `${packId}:${kind}:${key}`;

/** Structural checks so a broken pack never half-installs. */
export function validatePack(p: PackV1): string[] {
  const errors: string[] = [];
  if (p.format !== 1) errors.push("Unsupported pack format.");
  if (!/^[a-z0-9-]+$/.test(p.id ?? "")) errors.push("Pack id must be lowercase letters, digits and dashes.");
  const lists = ["topics", "subjects", "lessons", "questions", "flashcards", "formulas", "diagnostics"] as const;
  for (const k of lists) if (!Array.isArray(p[k])) errors.push(`The pack has no "${k}" list.`);
  if (errors.length) return errors;
  const keys = (list: { key: string }[], kind: string) => {
    const set = new Set<string>();
    for (const i of list) {
      if (!i.key) errors.push(`A ${kind} has no key.`);
      if (set.has(i.key)) errors.push(`Duplicate ${kind} key "${i.key}".`);
      set.add(i.key);
    }
    return set;
  };
  const topics = keys(p.topics, "topic");
  const subjects = keys(p.subjects, "subject");
  const lessons = keys(p.lessons, "lesson");
  const questions = keys(p.questions, "question");
  keys(p.flashcards, "flashcard");
  keys(p.formulas, "formula");
  keys(p.diagnostics, "diagnostic");
  const ref = (set: Set<string>, v: string | undefined, kind: string, owner: string) => {
    if (v && !set.has(v)) errors.push(`${owner} refers to unknown ${kind} "${v}".`);
  };
  for (const l of p.lessons) {
    if (!l.subject) errors.push(`Lesson ${l.key} has no subject.`);
    ref(subjects, l.subject, "subject", `Lesson ${l.key}`);
    ref(topics, l.topic, "topic", `Lesson ${l.key}`);
    if (![1, 2, 3, 4].includes(l.level)) errors.push(`Lesson ${l.key} has an invalid level.`);
  }
  for (const q of p.questions) {
    ref(subjects, q.subject, "subject", `Question ${q.key}`);
    ref(lessons, q.lesson, "lesson", `Question ${q.key}`);
    ref(topics, q.topic, "topic", `Question ${q.key}`);
    if (!(QUESTION_TYPES as readonly string[]).includes(q.type)) errors.push(`Question ${q.key} has unknown type "${q.type}".`);
    else for (const e of validateQuestionData({ ...q.data, type: q.type } as QuestionData)) errors.push(`Question ${q.key}: ${e}`);
    if (!(q.difficulty >= 1 && q.difficulty <= 5)) errors.push(`Question ${q.key} difficulty must be 1–5.`);
  }
  for (const c of p.flashcards) {
    ref(subjects, c.subject, "subject", `Flashcard ${c.key}`);
    ref(lessons, c.lesson, "lesson", `Flashcard ${c.key}`);
    ref(topics, c.topic, "topic", `Flashcard ${c.key}`);
  }
  for (const f of p.formulas) ref(topics, f.topic, "topic", `Formula ${f.key}`);
  for (const d of p.diagnostics) for (const q of d.questions) ref(questions, q, "question", `Diagnostic ${d.key}`);
  return errors;
}

export interface InstallResult {
  lessons: number;
  questions: number;
  flashcards: number;
  formulas: number;
  diagnostics: number;
}

export async function installedPackVersion(packId: string): Promise<number | null> {
  const db = await getDb();
  const rows = await db.select<{ v: number | null }>("SELECT pack_version AS v FROM learning_tracks WHERE id = $1 AND deleted_at IS NULL", [packItemId(packId, "track", "main")]);
  return rows[0]?.v ?? null;
}

export async function installPack(p: PackV1): Promise<InstallResult> {
  const errors = validatePack(p);
  if (errors.length) throw new Error(`This content pack is invalid: ${errors.slice(0, 3).join(" ")}`);
  const db = await getDb();
  const now = nowIso();
  const id = (kind: string, key: string | undefined) => (key ? packItemId(p.id, kind, key) : null);

  // Upsert helper: inserts, or updates the row (and undeletes it) if it exists.
  const upsert = async (table: string, row: Record<string, string | number | null>) => {
    const cols = Object.keys(row);
    const updates = cols.filter((c) => c !== "id" && c !== "created_at").map((c) => `${c} = excluded.${c}`);
    await db.execute(
      `INSERT INTO ${table} (${cols.join(", ")}, deleted_at) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, NULL)
       ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}, deleted_at = NULL`,
      Object.values(row),
    );
  };
  const base = { pack_id: p.id, created_at: now, updated_at: now };

  const trackId = packItemId(p.id, "track", "main");
  await upsert("learning_tracks", { id: trackId, title: p.title, description: p.description, color: p.color ?? null, pack_version: p.version, ...base });
  const topicSubject = new Map(p.topics.map((t) => [t.key, t.subject ?? null]));
  for (const t of p.topics) await upsert("topics", { id: id("topic", t.key)!, name: t.name, subject: t.subject ?? null, ...base });
  for (const [i, s] of p.subjects.entries()) {
    await upsert("subjects", { id: id("subject", s.key)!, track_id: trackId, name: s.name, description: s.description ?? null, sort_order: i, ...base });
  }
  for (const [i, l] of p.lessons.entries()) {
    await upsert("lessons", {
      id: id("lesson", l.key)!,
      subject_id: id("subject", l.subject)!,
      level: l.level,
      sort_order: i,
      title: l.title,
      summary: l.summary ?? null,
      content: l.content,
      topic_id: id("topic", l.topic),
      estimated_minutes: l.minutes ?? null,
      ...base,
    });
  }
  const lessonSubject = new Map(p.lessons.map((l) => [l.key, l.subject]));
  for (const q of p.questions) {
    await upsert("questions", {
      id: id("question", q.key)!,
      type: q.type,
      prompt: q.prompt,
      data: JSON.stringify(q.data),
      explanation: q.explanation ?? null,
      why_wrong: q.whyWrong ?? null,
      example: q.example ?? null,
      hint: q.hint ?? null,
      difficulty: q.difficulty,
      topic_id: id("topic", q.topic),
      lesson_id: id("lesson", q.lesson),
      subject_id: id("subject", q.subject ?? (q.lesson ? lessonSubject.get(q.lesson) : undefined)),
      course_id: null,
      tags: JSON.stringify(q.tags ?? []),
      ...base,
    });
  }
  for (const c of p.flashcards) {
    await upsert("flashcards", {
      id: id("card", c.key)!,
      front: c.front,
      back: c.back,
      course_id: null,
      topic_id: id("topic", c.topic),
      lesson_id: id("lesson", c.lesson),
      note_id: null,
      subject_id: id("subject", c.subject ?? (c.lesson ? lessonSubject.get(c.lesson) : undefined)),
      tags: JSON.stringify(c.tags ?? []),
      ...base,
    });
  }
  for (const f of p.formulas) {
    await upsert("formulas", {
      id: id("formula", f.key)!,
      title: f.title,
      latex: f.latex,
      explanation: f.explanation ?? null,
      variables: JSON.stringify(f.variables ?? []),
      example: f.example ?? null,
      subject: f.subject ?? (f.topic ? (topicSubject.get(f.topic) ?? null) : null),
      topic_id: id("topic", f.topic),
      course_ids: "[]",
      note_ids: "[]",
      tags: JSON.stringify(f.tags ?? []),
      ...base,
    });
  }
  for (const d of p.diagnostics) {
    await upsert("diagnostics", {
      id: id("diagnostic", d.key)!,
      title: d.title,
      description: d.description ?? null,
      track_id: trackId,
      question_ids: JSON.stringify(d.questions.map((k) => id("question", k))),
      ...base,
    });
  }
  return { lessons: p.lessons.length, questions: p.questions.length, flashcards: p.flashcards.length, formulas: p.formulas.length, diagnostics: p.diagnostics.length };
}
