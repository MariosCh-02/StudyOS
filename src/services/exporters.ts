/**
 * Human-readable exports: Markdown (notes, course notes, projects) and CSV
 * (grades, tasks, flashcards). Full machine-readable exports live in backup.ts.
 */
import { getDb } from "@/lib/db";
import { parseDoc } from "@/domain/noteContent";
import { docToMarkdown } from "@/domain/noteMarkdown";
import { formatApa } from "@/domain/research";
import { formatDate, toDateKey } from "@/domain/dates";
import { getCourse } from "./courses";
import { getNote } from "./notes";
import { listAssignments, listExams, ASSESSMENT_LABELS } from "./assessments";
import { listTasks, TASK_LABELS } from "./tracking";
import { listFlashcards } from "./practice";
import { getProject, listMilestones, listProjectNotes, PROJECT_LABELS, SECTION_META } from "./projects";
import { listPapers } from "./papers";

// ------------------------------------------------------------------- CSV

const cell = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  // Quote when needed; neutralise leading =,+,-,@ so spreadsheets don't run them as formulas.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** RFC 4180 CSV with a UTF-8 BOM so Excel opens accents and Greek correctly. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return `﻿${[header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

const pct = (score: number | null, max: number | null) => (score != null && max ? Math.round((score / max) * 1000) / 10 : null);

/** Every graded or upcoming assignment and exam, for one course or all of them. */
export async function gradesCsv(courseId?: string): Promise<string> {
  const [assignments, exams] = await Promise.all([listAssignments({ courseId }), listExams({ courseId })]);
  const rows = [
    ...assignments.map((a) => [a.courseCode ?? "", a.courseName, "Assignment", a.title, ASSESSMENT_LABELS.assignmentStatus[a.status], a.dueAt?.replace("T", " ") ?? "", a.weight, a.score, a.maxScore, pct(a.score, a.maxScore)]),
    ...exams.map((e) => [e.courseCode ?? "", e.courseName, ASSESSMENT_LABELS.examKind[e.kind], e.title, e.score != null ? "Graded" : "", e.startAt?.replace("T", " ") ?? "", e.weight, e.score, e.maxScore, pct(e.score, e.maxScore)]),
  ].sort((a, b) => `${a[1]}${a[5]}`.localeCompare(`${b[1]}${b[5]}`));
  return toCsv(["Course code", "Course", "Type", "Title", "Status", "Date", "Weight %", "Score", "Max score", "Percent"], rows);
}

export async function tasksCsv(): Promise<string> {
  const tasks = await listTasks();
  return toCsv(
    ["Task", "Status", "Priority", "Due", "Course", "Project", "Estimate (min)", "Completed", "Notes"],
    tasks.map((t) => [t.title, TASK_LABELS.status[t.status], TASK_LABELS.priority[t.priority], t.dueAt?.replace("T", " ") ?? "", t.courseName ?? "", t.projectTitle ?? "", t.estimatedMinutes, t.completedAt?.slice(0, 10) ?? "", t.notes ?? ""]),
  );
}

/** Front/back/tags: imports directly into Anki and most flashcard apps. */
export async function flashcardsCsv(courseId?: string): Promise<string> {
  const cards = await listFlashcards(courseId ? { courseId } : {});
  return toCsv(["Front", "Back", "Tags"], cards.map((c) => [c.front, c.back, c.tags.join(" ")]));
}

// -------------------------------------------------------------- Markdown

const yamlish = (pairs: [string, string | null | undefined][]) =>
  pairs
    .filter(([, v]) => v)
    .map(([k, v]) => `**${k}:** ${v}`)
    .join(" · ");

export async function noteMarkdown(noteId: string): Promise<{ title: string; markdown: string }> {
  const note = await getNote(noteId);
  if (!note) throw new Error("Note not found.");
  const course = note.courseId ? await getCourse(note.courseId) : null;
  const title = note.title || "Untitled note";
  const meta = yamlish([
    ["Course", course ? (course.code ? `${course.code} · ${course.name}` : course.name) : null],
    ["Updated", formatDate(note.updatedAt.slice(0, 10))],
  ]);
  const body = docToMarkdown(parseDoc(note.content));
  // Notes created from templates often start with their own title heading.
  const startsWithTitle = body.startsWith(`# ${title}\n`) || body === `# ${title}`;
  return { title, markdown: `${startsWithTitle ? "" : `# ${title}\n\n`}${meta ? `${meta}\n\n` : ""}${body}\n` };
}

/** All notes of a course (lecture notes in lecture order, then other notes). */
export async function courseNotesMarkdown(courseId: string): Promise<{ title: string; markdown: string }> {
  const course = await getCourse(courseId);
  if (!course) throw new Error("Course not found.");
  const db = await getDb();
  const rows = await db.select<{ id: string; title: string; content: string; lecture_title: string | null; lecture_date: string | null; lecture_number: number | null }>(
    `SELECT n.id, n.title, n.content, l.title AS lecture_title, l.date AS lecture_date, l.number AS lecture_number
     FROM notes n LEFT JOIN lectures l ON l.id = n.lecture_id AND l.deleted_at IS NULL
     WHERE n.deleted_at IS NULL AND n.course_id = $1
     ORDER BY n.lecture_id IS NULL, l.date, l.number, n.created_at`,
    [courseId],
  );
  const name = course.code ? `${course.code} · ${course.name}` : course.name;
  const parts = rows.map((r) => {
    const heading = r.title || r.lecture_title || "Untitled note";
    const sub = r.lecture_date ? `_${r.lecture_number != null ? `Lecture ${r.lecture_number} · ` : ""}${formatDate(r.lecture_date)}_\n\n` : "";
    // Demote the note's own headings by one level so they sit under the note title.
    const body = docToMarkdown(parseDoc(r.content)).replace(/^(#{1,5}) /gm, "#$1 ");
    return `## ${heading}\n\n${sub}${body}`;
  });
  return { title: `${name} notes`, markdown: `# ${name}\n\n${rows.length} notes, exported ${formatDate(toDateKey(new Date()))}.\n\n${parts.join("\n\n---\n\n")}\n` };
}

export async function projectMarkdown(projectId: string): Promise<{ title: string; markdown: string }> {
  const p = await getProject(projectId);
  if (!p) throw new Error("Project not found.");
  const [milestones, tasks, notes, papers] = await Promise.all([listMilestones(p.id), listTasks({ projectId: p.id }), listProjectNotes(p.id), listPapers({ projectId: p.id })]);
  const db = await getDb();
  const out: string[] = [`# ${p.title}`, ""];
  out.push(
    yamlish([
      ["Type", PROJECT_LABELS.kind[p.kind]],
      ["Status", PROJECT_LABELS.status[p.status]],
      ["Course", p.courseName],
      ["Start", p.startDate ? formatDate(p.startDate) : null],
      ["Due", p.dueDate ? formatDate(p.dueDate) : null],
    ]),
    "",
  );
  if (p.researchQuestion) out.push("## Research question", "", p.researchQuestion, "");
  if (p.description) out.push("## Description", "", p.description, "");
  if (p.members.length) out.push("## Team", "", ...p.members.map((m) => `- ${m.name}${m.role ? ` (${m.role})` : ""}${m.email ? ` · ${m.email}` : ""}`), "");
  if (p.links.length) out.push("## Links", "", ...p.links.map((l) => `- [${l.label}](${l.url})`), "");
  if (milestones.length) out.push("## Milestones", "", ...milestones.map((m) => `- [${m.doneAt ? "x" : " "}] ${m.title}${m.dueDate ? ` (${formatDate(m.dueDate)})` : ""}`), "");
  if (tasks.length) out.push("## Tasks", "", ...tasks.map((t) => `- [${t.status === "done" ? "x" : " "}] ${t.title}${t.dueAt ? ` (due ${formatDate(t.dueAt.slice(0, 10))})` : ""}`), "");
  for (const n of notes) {
    const rows = await db.select<{ content: string }>("SELECT content FROM notes WHERE id = $1", [n.id]);
    const label = n.section ? `${SECTION_META[n.section].label}: ` : "";
    const title = n.title.startsWith(SECTION_META[n.section ?? "draft"].label) ? n.title : `${label}${n.title || "Untitled note"}`;
    out.push(`## ${title}`, "", docToMarkdown(parseDoc(rows[0]?.content)).replace(/^(#{1,5}) /gm, "#$1 "), "");
  }
  if (papers.length) out.push("## References", "", ...papers.map((x) => formatApa(x).markdown).sort((a, b) => a.localeCompare(b)).flatMap((r) => [r, ""]));
  return { title: p.title, markdown: `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n` };
}

/** File-name-safe version of a title. */
export function fileSafe(title: string, fallback = "studyos-export"): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, "");
  return s || fallback;
}

