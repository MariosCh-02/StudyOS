/**
 * Performance guard: a database the size of several years of study must keep
 * the main screens fast. Runs against in-memory SQLite (sql.js, WebAssembly),
 * which is several times slower than the app's native SQLite, so the limits
 * here are generous upper bounds rather than targets.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import { scaleFromPreset } from "../src/domain/grading";
import { createInstitution } from "../src/services/institutions";
import { createProgramme } from "../src/services/programmes";
import { createCourse } from "../src/services/courses";
import { getDashboard } from "../src/services/dashboard";
import { listNotes, getNote } from "../src/services/notes";
import { dueCounts, listFlashcards, listQuestions, topicMastery } from "../src/services/practice";
import { search } from "../src/services/search";
import { getCalendarItems } from "../src/services/calendar";
import { listTasks } from "../src/services/tracking";
import { getPerformance } from "../src/services/performance";
import { listTags } from "../src/services/tags";
import { listAllAttachments } from "../src/services/attachments";
import { listProjects } from "../src/services/projects";
import { listPapers } from "../src/services/papers";

const N = { courses: 40, notes: 4000, cards: 4000, questions: 3000, tasks: 1500, files: 400, events: 1500, attempts: 6000, reviews: 8000 };
const timings: Record<string, number> = {};
let db: Awaited<ReturnType<typeof createTestDb>>;

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const r = await fn();
  timings[label] = Math.round(performance.now() - t0);
  return r;
}

beforeAll(async () => {
  db = await createTestDb();
  const i = await createInstitution({ name: "UCY", kind: "university", country: null, website: null, notes: null });
  const p = await createProgramme({ institutionId: i.id, name: "MSc AI", level: "master", status: "active", field: null, startDate: null, endDate: null, totalCredits: 90, creditUnit: "ECTS", gradingScale: scaleFromPreset("ten_point"), targetGrade: null, color: null, notes: null });
  const courses: string[] = [];
  for (let c = 0; c < N.courses; c++) {
    courses.push((await createCourse({ programmeId: p.id, semesterId: null, name: `Course ${c}`, code: `C${c}`, credits: 5, lecturer: null, lecturerEmail: null, location: null, status: "in_progress", finalGrade: null, targetGrade: null, color: null, description: null })).id);
  }
  // Bulk rows straight into SQLite (the services would be far slower to seed with).
  const raw = db.raw;
  const now = "2026-10-07T10:00:00.000Z";
  const words = ["gradient", "descent", "matrix", "eigenvalue", "probability", "bayes", "kernel", "entropy", "regression", "network", "backprop", "variance"];
  const text = (k: number) => Array.from({ length: 120 }, (_, j) => words[(k * 7 + j * 5) % words.length]).join(" ");
  raw.run("BEGIN");
  for (let t = 0; t < 60; t++) raw.run("INSERT INTO topics (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)", [`t${t}`, `Topic ${t}`, now, now]);
  for (let k = 0; k < N.notes; k++) {
    const body = text(k);
    raw.run("INSERT INTO notes (id, course_id, title, content, content_text, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)", [
      `n${k}`,
      courses[k % N.courses]!,
      `Note ${k}`,
      JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] }),
      body,
      now,
      `2026-${String(1 + (k % 9)).padStart(2, "0")}-01T00:00:00.000Z`,
    ]);
  }
  for (let k = 0; k < N.cards; k++) {
    raw.run("INSERT INTO flashcards (id, front, back, course_id, topic_id, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '[]', ?, ?)", [`f${k}`, `Front ${k} ${words[k % 12]}`, `Back ${k}`, courses[k % N.courses]!, `t${k % 60}`, now, now]);
    raw.run("INSERT INTO srs_state (id, item_type, item_id, due_date, interval_days, ease, reps, lapses, created_at, updated_at) VALUES (?, 'card', ?, ?, 3, 2.5, 2, 0, ?, ?)", [`s${k}`, `f${k}`, `2026-10-${String(1 + (k % 28)).padStart(2, "0")}`, now, now]);
  }
  for (let k = 0; k < N.questions; k++) {
    raw.run("INSERT INTO questions (id, type, prompt, data, difficulty, topic_id, course_id, tags, created_at, updated_at) VALUES (?, 'short', ?, ?, 2, ?, ?, '[]', ?, ?)", [`q${k}`, `Question ${k} about ${words[k % 12]}`, JSON.stringify({ type: "short", accepted: ["x"] }), `t${k % 60}`, courses[k % N.courses]!, now, now]);
  }
  for (let k = 0; k < N.attempts; k++) {
    raw.run("INSERT INTO question_attempts (id, question_id, response, score, answered_at, created_at, updated_at) VALUES (?, ?, '{}', ?, ?, ?, ?)", [`a${k}`, `q${k % N.questions}`, k % 3 === 0 ? 0 : 1, `2026-${String(1 + (k % 9)).padStart(2, "0")}-15T10:00:00.000Z`, now, now]);
  }
  for (let k = 0; k < N.reviews; k++) {
    raw.run("INSERT INTO flashcard_reviews (id, card_id, rating, interval_days, reviewed_at, created_at, updated_at) VALUES (?, ?, 'good', 3, ?, ?, ?)", [`r${k}`, `f${k % N.cards}`, `2026-${String(1 + (k % 9)).padStart(2, "0")}-10T10:00:00.000Z`, now, now]);
  }
  for (let k = 0; k < N.tasks; k++) {
    raw.run("INSERT INTO tasks (id, title, course_id, due_at, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'medium', ?, ?, ?)", [`k${k}`, `Task ${k}`, courses[k % N.courses]!, `2026-${String(1 + (k % 12)).padStart(2, "0")}-10T12:00`, k % 2 ? "done" : "todo", now, now]);
  }
  for (let k = 0; k < N.files; k++) {
    raw.run("INSERT INTO attachments (id, owner_type, owner_id, file_name, stored_name, mime_type, size_bytes, created_at, updated_at) VALUES (?, 'course', ?, ?, ?, 'application/pdf', 1000, ?, ?)", [`x${k}`, courses[k % N.courses]!, `slides-${k}.pdf`, `00000000-0000-0000-0000-${String(k).padStart(12, "0")}.pdf`, now, now]);
  }
  for (let k = 0; k < N.events; k++) {
    const d = `2026-${String(1 + (k % 12)).padStart(2, "0")}-${String(1 + (k % 28)).padStart(2, "0")}`;
    raw.run("INSERT INTO calendar_events (id, type, title, start_at, end_at, all_day, course_id, created_at, updated_at) VALUES (?, 'study', ?, ?, ?, 0, ?, ?, ?)", [`e${k}`, `Event ${k}`, `${d}T09:00`, `${d}T10:00`, courses[k % N.courses]!, now, now]);
  }
  raw.run("COMMIT");
}, 120_000);

describe("with years of data", () => {
  it("keeps the main screens fast", async () => {
    await time("dashboard", () => getDashboard("2026-10-07"));
    const notes = await time("notes list", () => listNotes());
    expect(notes).toHaveLength(200); // paginated
    await time("note open", () => getNote("n1234"));
    await time("notes filter", () => listNotes({ search: "eigenvalue" }));
    await time("flashcards", () => listFlashcards({}));
    await time("due counts", () => dueCounts("2026-10-07"));
    await time("questions", () => listQuestions({}));
    await time("mastery", () => topicMastery("2026-10-07"));
    expect((await time("search", () => search("gradient desc"))).length).toBeGreaterThan(0);
    await time("calendar month", () => getCalendarItems("2026-10-01", "2026-10-31"));
    await time("tasks", () => listTasks({ doneSince: "2026-10-01" }));
    await time("grades", () => getPerformance(1));
    await time("tags", () => listTags());
    await time("files", () => listAllAttachments());
    await time("projects", () => listProjects());
    await time("papers", () => listPapers());
    console.table(timings);
    for (const [label, ms] of Object.entries(timings)) expect(ms, label).toBeLessThan(1500);
  }, 60_000);
});
