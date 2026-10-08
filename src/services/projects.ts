/**
 * Projects (AI, research, programming, group, thesis…) with milestones, tasks,
 * files, notes and, for research work, a structured workspace.
 */
import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import { isDateKey } from "@/domain/dates";
import { assertValid, blankToNull, dateOrder, optionalDate, requireText } from "@/domain/validation";
import { parseMilestones, projectProgress, spreadDates, type Progress } from "@/domain/research";
import { sectionsDoc } from "@/domain/noteContent";
import { createNote, getNote } from "./notes";
import type { Note, NoteSummary } from "@/domain/types";

export const PROJECT_KINDS = ["ai", "research", "programming", "group", "thesis", "other"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];
export const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_LABELS = {
  kind: { ai: "AI / ML", research: "Research", programming: "Programming", group: "Group", thesis: "Thesis", other: "Other" },
  status: { planning: "Planning", active: "Active", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled" },
} as const;

/** Kinds that get the research workspace (question, literature, methodology…). */
export const RESEARCH_KINDS: readonly ProjectKind[] = ["research", "thesis"];

export interface ProjectMember {
  name: string;
  role: string;
  email: string;
}
export interface ProjectLink {
  label: string;
  url: string;
}

export interface Project {
  id: string;
  title: string;
  kind: ProjectKind;
  status: ProjectStatus;
  description: string | null;
  researchQuestion: string | null;
  courseId: string | null;
  lessonId: string | null;
  startDate: string | null;
  dueDate: string | null;
  members: ProjectMember[];
  links: ProjectLink[];
  createdAt: string;
  updatedAt: string;
  courseName: string | null;
  courseCode: string | null;
  courseColor: string | null;
}

export type ProjectInput = Pick<Project, "title" | "kind" | "status" | "description" | "researchQuestion" | "courseId" | "startDate" | "dueDate" | "members" | "links">;

export interface ProjectSummary extends Project {
  progress: Progress;
  nextMilestone: { title: string; dueDate: string | null } | null;
  paperCount: number;
}

interface Row {
  id: string;
  title: string;
  kind: ProjectKind;
  status: ProjectStatus;
  description: string | null;
  research_question: string | null;
  course_id: string | null;
  lesson_id: string | null;
  start_date: string | null;
  due_date: string | null;
  members: string;
  links: string;
  created_at: string;
  updated_at: string;
  course_name: string | null;
  course_code: string | null;
  course_color: string | null;
}

function parseJsonArray<T>(text: string): T[] {
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

const map = (r: Row): Project => ({
  id: r.id,
  title: r.title,
  kind: r.kind,
  status: r.status,
  description: r.description,
  researchQuestion: r.research_question,
  courseId: r.course_id,
  lessonId: r.lesson_id,
  startDate: r.start_date,
  dueDate: r.due_date,
  members: parseJsonArray<ProjectMember>(r.members),
  links: parseJsonArray<ProjectLink>(r.links),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  courseName: r.course_name,
  courseCode: r.course_code,
  courseColor: r.course_color,
});

const SELECT = `SELECT p.*, c.name AS course_name, c.code AS course_code, c.color AS course_color
  FROM projects p LEFT JOIN courses c ON c.id = p.course_id AND c.deleted_at IS NULL WHERE p.deleted_at IS NULL`;

const isWebUrl = (u: string) => /^https?:\/\/\S+$/i.test(u.trim());

function validate(input: ProjectInput): ProjectInput {
  const badLink = input.links.find((l) => l.url.trim() && !isWebUrl(l.url));
  const badEmail = input.members.find((m) => m.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email.trim()));
  assertValid({
    title: requireText(input.title, "Project title", 200),
    kind: (PROJECT_KINDS as readonly string[]).includes(input.kind) ? undefined : "Choose a project type.",
    status: (PROJECT_STATUSES as readonly string[]).includes(input.status) ? undefined : "Choose a status.",
    startDate: optionalDate(input.startDate, "Start date"),
    dueDate: optionalDate(input.dueDate, "Due date") ?? dateOrder(input.startDate, input.dueDate),
    links: badLink ? `"${badLink.url}" is not a web address (https://…).` : undefined,
    members: badEmail ? `"${badEmail.email}" is not a valid email address.` : undefined,
  });
  return {
    ...input,
    title: input.title.trim(),
    description: blankToNull(input.description),
    researchQuestion: blankToNull(input.researchQuestion),
    courseId: input.courseId || null,
    startDate: input.startDate || null,
    dueDate: input.dueDate || null,
    members: input.members.map((m) => ({ name: m.name.trim(), role: m.role.trim(), email: m.email.trim() })).filter((m) => m.name),
    links: input.links.map((l) => ({ label: l.label.trim() || l.url.trim(), url: l.url.trim() })).filter((l) => l.url),
  };
}

export async function getProject(id: string): Promise<Project | null> {
  const db = await getDb();
  const rows = await db.select<Row>(`${SELECT} AND p.id = $1`, [id]);
  return rows[0] ? map(rows[0]) : null;
}

export async function listProjects(filter: { courseId?: string; status?: ProjectStatus | "open" } = {}): Promise<ProjectSummary[]> {
  const db = await getDb();
  const params: string[] = [];
  let sql = SELECT;
  if (filter.courseId) {
    params.push(filter.courseId);
    sql += ` AND p.course_id = $${params.length}`;
  }
  if (filter.status === "open") sql += " AND p.status IN ('planning', 'active', 'on_hold')";
  else if (filter.status) {
    params.push(filter.status);
    sql += ` AND p.status = $${params.length}`;
  }
  const [rows, milestones, tasks, papers] = await Promise.all([
    db.select<Row>(`${sql} ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 WHEN 'on_hold' THEN 2 ELSE 3 END, p.due_date IS NULL, p.due_date, p.title COLLATE NOCASE`, params),
    db.select<{ project_id: string; title: string; due_date: string | null; done_at: string | null }>(
      "SELECT project_id, title, due_date, done_at FROM project_milestones WHERE deleted_at IS NULL ORDER BY sort_order, due_date",
    ),
    db.select<{ project_id: string; status: string }>("SELECT project_id, status FROM tasks WHERE deleted_at IS NULL AND project_id IS NOT NULL"),
    db.select<{ project_id: string; n: number }>(
      `SELECT pp.project_id, COUNT(*) AS n FROM project_papers pp JOIN papers pa ON pa.id = pp.paper_id AND pa.deleted_at IS NULL
       WHERE pp.deleted_at IS NULL GROUP BY pp.project_id`,
    ),
  ]);
  const paperCounts = new Map(papers.map((p) => [p.project_id, p.n]));
  return rows.map((r) => {
    const ms = milestones.filter((m) => m.project_id === r.id);
    const ts = tasks.filter((t) => t.project_id === r.id);
    const next = ms.find((m) => !m.done_at);
    return {
      ...map(r),
      progress: projectProgress(
        ms.map((m) => ({ done: m.done_at != null })),
        ts.map((t) => ({ done: t.status === "done" })),
      ),
      nextMilestone: next ? { title: next.title, dueDate: next.due_date } : null,
      paperCount: paperCounts.get(r.id) ?? 0,
    };
  });
}

async function insertProject(v: ProjectInput, lessonId: string | null): Promise<string> {
  const db = await getDb();
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO projects (id, title, kind, status, description, research_question, course_id, lesson_id, start_date, due_date, members, links, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
    [id, v.title, v.kind, v.status, v.description, v.researchQuestion, v.courseId, lessonId, v.startDate, v.dueDate, JSON.stringify(v.members), JSON.stringify(v.links), now],
  );
  return id;
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const id = await insertProject(validate(input), null);
  return (await getProject(id))!;
}

export async function updateProject(id: string, input: ProjectInput): Promise<Project> {
  const v = validate(input);
  const db = await getDb();
  await db.execute(
    `UPDATE projects SET title = $2, kind = $3, status = $4, description = $5, research_question = $6, course_id = $7, start_date = $8, due_date = $9,
       members = $10, links = $11, updated_at = $12 WHERE id = $1 AND deleted_at IS NULL`,
    [id, v.title, v.kind, v.status, v.description, v.researchQuestion, v.courseId, v.startDate, v.dueDate, JSON.stringify(v.members), JSON.stringify(v.links), nowIso()],
  );
  const p = await getProject(id);
  if (!p) throw new Error("Project not found.");
  return p;
}

export async function setProjectStatus(id: string, status: ProjectStatus): Promise<void> {
  const p = await getProject(id);
  if (!p) throw new Error("Project not found.");
  await updateProject(id, { ...p, status });
}

/**
 * Deletes a project with its milestones, files, notes and literature list.
 * Tasks are kept (unlinked) and papers stay in the library.
 */
export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE project_milestones SET deleted_at = $2, updated_at = $2 WHERE project_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE project_papers SET deleted_at = $2, updated_at = $2 WHERE project_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE attachments SET deleted_at = $2, updated_at = $2 WHERE owner_type = 'project' AND owner_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute(
    "UPDATE attachments SET deleted_at = $2, updated_at = $2 WHERE owner_type = 'note' AND deleted_at IS NULL AND owner_id IN (SELECT id FROM notes WHERE project_id = $1 AND deleted_at IS NULL)",
    [id, now],
  );
  await db.execute("UPDATE notes SET deleted_at = $2, updated_at = $2 WHERE project_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE tasks SET project_id = NULL, updated_at = $2 WHERE project_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE knowledge_links SET deleted_at = $2, updated_at = $2 WHERE target_type = 'project' AND target_id = $1 AND deleted_at IS NULL", [id, now]);
  await db.execute("UPDATE projects SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

// -------------------------------------------------------------- milestones

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  dueDate: string | null;
  doneAt: string | null;
  sortOrder: number;
}

interface MilestoneRow {
  id: string;
  project_id: string;
  title: string;
  due_date: string | null;
  done_at: string | null;
  sort_order: number;
}

const mapMilestone = (r: MilestoneRow): Milestone => ({ id: r.id, projectId: r.project_id, title: r.title, dueDate: r.due_date, doneAt: r.done_at, sortOrder: r.sort_order });

export async function listMilestones(projectId: string): Promise<Milestone[]> {
  const db = await getDb();
  const rows = await db.select<MilestoneRow>(
    "SELECT * FROM project_milestones WHERE project_id = $1 AND deleted_at IS NULL ORDER BY sort_order, due_date IS NULL, due_date, created_at",
    [projectId],
  );
  return rows.map(mapMilestone);
}

function validateMilestone(title: string, dueDate: string | null) {
  assertValid({ title: requireText(title, "Milestone", 200), dueDate: optionalDate(dueDate, "Due date") });
}

export async function addMilestone(projectId: string, title: string, dueDate: string | null): Promise<string> {
  validateMilestone(title, dueDate);
  const db = await getDb();
  const max = await db.select<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM project_milestones WHERE project_id = $1 AND deleted_at IS NULL", [projectId]);
  const id = newId();
  const now = nowIso();
  await db.execute(
    "INSERT INTO project_milestones (id, project_id, title, due_date, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)",
    [id, projectId, title.trim(), dueDate || null, (max[0]?.m ?? -1) + 1, now],
  );
  return id;
}

export async function updateMilestone(id: string, title: string, dueDate: string | null): Promise<void> {
  validateMilestone(title, dueDate);
  const db = await getDb();
  await db.execute("UPDATE project_milestones SET title = $2, due_date = $3, updated_at = $4 WHERE id = $1 AND deleted_at IS NULL", [id, title.trim(), dueDate || null, nowIso()]);
}

export async function setMilestoneDone(id: string, done: boolean): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE project_milestones SET done_at = $2, updated_at = $3 WHERE id = $1 AND deleted_at IS NULL", [id, done ? now : null, now]);
}

export async function deleteMilestone(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.execute("UPDATE project_milestones SET deleted_at = $2, updated_at = $2 WHERE id = $1 AND deleted_at IS NULL", [id, now]);
}

/** Moves a milestone one place up (-1) or down (+1). */
export async function moveMilestone(projectId: string, id: string, delta: -1 | 1): Promise<void> {
  const list = await listMilestones(projectId);
  const i = list.findIndex((m) => m.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j]!, list[i]!];
  const db = await getDb();
  const now = nowIso();
  for (let k = 0; k < list.length; k++) {
    if (list[k]!.sortOrder !== k) await db.execute("UPDATE project_milestones SET sort_order = $2, updated_at = $3 WHERE id = $1", [list[k]!.id, k, now]);
  }
}

// ---------------------------------------------- projects from guided lessons

/** The (undeleted) project started from a guided-project lesson, if any. */
export async function projectForLesson(lessonId: string): Promise<Project | null> {
  const db = await getDb();
  const rows = await db.select<Row>(`${SELECT} AND p.lesson_id = $1 ORDER BY p.created_at DESC LIMIT 1`, [lessonId]);
  return rows[0] ? map(rows[0]) : null;
}

/**
 * Starts a project from a guided-project lesson: one milestone per numbered
 * step under "## Milestones", with due dates spread evenly up to the due
 * date when one is given. Returns the existing project if already started.
 */
export async function startProjectFromLesson(lessonId: string, opts: { startDate: string; dueDate: string | null }): Promise<Project> {
  const existing = await projectForLesson(lessonId);
  if (existing) return existing;
  const db = await getDb();
  const lessons = await db.select<{ id: string; title: string; summary: string | null; content: string }>(
    "SELECT id, title, summary, content FROM lessons WHERE id = $1 AND deleted_at IS NULL",
    [lessonId],
  );
  const lesson = lessons[0];
  if (!lesson) throw new Error("Lesson not found.");
  if (!isDateKey(opts.startDate)) throw new Error("Choose a valid start date.");
  const v = validate({
    title: lesson.title,
    kind: "ai",
    status: "active",
    description: lesson.summary ?? null,
    researchQuestion: null,
    courseId: null,
    startDate: opts.startDate,
    dueDate: opts.dueDate,
    members: [],
    links: [],
  });
  const id = await insertProject(v, lesson.id);
  const titles = parseMilestones(lesson.content);
  const dates = v.dueDate ? spreadDates(v.startDate!, v.dueDate, titles.length) : [];
  for (const [k, title] of titles.entries()) await addMilestone(id, title, dates[k] ?? null);
  return (await getProject(id))!;
}

// -------------------------------------------------------- research workspace

export const SINGLE_SECTIONS = ["question", "literature", "methodology", "results"] as const;
export const MULTI_SECTIONS = ["experiment", "meeting", "draft"] as const;
export type WorkspaceSection = (typeof SINGLE_SECTIONS)[number] | (typeof MULTI_SECTIONS)[number];

export const SECTION_META: Record<WorkspaceSection, { label: string; hint: string; template: readonly string[] }> = {
  question: {
    label: "Research question",
    hint: "What exactly are you trying to find out, and why does it matter?",
    template: ["Research question", "Motivation", "Scope and assumptions", "Hypotheses"],
  },
  literature: {
    label: "Literature review",
    hint: "Themes across the papers you read, and the gap your work addresses.",
    template: ["Themes", "Key papers", "Open problems and the gap"],
  },
  methodology: {
    label: "Methodology",
    hint: "Data, methods, experimental design and how you will evaluate results.",
    template: ["Data", "Methods", "Evaluation", "Threats to validity"],
  },
  results: {
    label: "Results",
    hint: "What you found, with figures and tables, and what it means.",
    template: ["Findings", "Discussion", "Limitations and future work"],
  },
  experiment: {
    label: "Experiment log",
    hint: "One entry per run: setup, parameters, outcome, next step.",
    template: ["Goal", "Setup and parameters", "Result", "Next step"],
  },
  meeting: {
    label: "Meeting notes",
    hint: "Supervisor and team meetings: decisions and action points.",
    template: ["Attendees", "Discussion", "Decisions", "Action points"],
  },
  draft: {
    label: "Drafts",
    hint: "Chapter and paper drafts.",
    template: [],
  },
};

export const isWorkspaceSection = (s: string): s is WorkspaceSection => s in SECTION_META;

export interface ProjectNote extends NoteSummary {
  section: WorkspaceSection | null;
}

export async function listProjectNotes(projectId: string): Promise<ProjectNote[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; title: string; snippet: string; pinned: number; section: string | null; created_at: string; updated_at: string; course_id: string | null }>(
    `SELECT id, title, substr(content_text, 1, 240) AS snippet, pinned, section, course_id, created_at, updated_at
     FROM notes WHERE project_id = $1 AND deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC`,
    [projectId],
  );
  return rows.map((r) => ({
    id: r.id,
    courseId: r.course_id,
    lectureId: null,
    title: r.title,
    snippet: r.snippet,
    pinned: r.pinned === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    section: r.section && isWorkspaceSection(r.section) ? r.section : null,
  }));
}

/** Adds a note to a project, optionally in a workspace section (pre-filled from its template). */
export async function createProjectNote(projectId: string, section: WorkspaceSection | null, title?: string): Promise<Note> {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found.");
  const meta = section ? SECTION_META[section] : null;
  const noteTitle = title ?? (meta ? `${meta.label} — ${project.title}` : "");
  return createNote({
    projectId,
    section,
    courseId: project.courseId,
    title: noteTitle,
    doc: meta?.template.length ? sectionsDoc(noteTitle, meta.template) : undefined,
  });
}

/** The single note for a section such as "methodology", created on first use. */
export async function getOrCreateSectionNote(projectId: string, section: (typeof SINGLE_SECTIONS)[number]): Promise<Note> {
  const db = await getDb();
  const rows = await db.select<{ id: string }>(
    "SELECT id FROM notes WHERE project_id = $1 AND section = $2 AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
    [projectId, section],
  );
  if (rows[0]) return (await getNote(rows[0].id))!;
  return createProjectNote(projectId, section);
}
