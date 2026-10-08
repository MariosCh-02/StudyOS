/**
 * Read-only tools the study assistant can call to look things up in the
 * student's StudyOS data. Each returns compact JSON for the model, a short
 * description of what it did (shown in the chat) and links to the items used.
 */
import { addDays, dateOf, nowLocal, type DateKey } from "@/domain/time";
import { parseDoc } from "@/domain/noteContent";
import { docToMarkdown } from "@/domain/noteMarkdown";
import { formatGrade } from "@/domain/grading";
import { listProgrammes } from "../programmes";
import { getCourse, listCourses } from "../courses";
import { getNote, listNotes } from "../notes";
import { getLecture } from "../lectures";
import { getAssignment, getCourseStanding, getExam, listAssignments, listExams } from "../assessments";
import { getCalendarItems } from "../calendar";
import { listStudySessions, listTasks } from "../tracking";
import { getPerformance } from "../performance";
import { dueCounts, topicMastery } from "../practice";
import { getEntry } from "../knowledge";
import { getPaper } from "../papers";
import { getProject, listMilestones } from "../projects";
import { getLesson } from "../learning";
import { resultHref, search, type SearchType } from "../search";
import type { ToolDef } from "./providers";

export interface Source {
  label: string;
  href: string;
}

export interface ToolResult {
  /** What the model sees (JSON text). */
  content: string;
  /** Shown in the chat, e.g. "Searched your notes for “gradient descent”". */
  summary: string;
  sources: Source[];
}

interface Tool {
  def: ToolDef;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const MAX_TOOL_CHARS = 9000;
const clip = (s: string, n = MAX_TOOL_CHARS) => (s.length > n ? `${s.slice(0, n)} …[truncated]` : s);
const json = (v: unknown) => clip(JSON.stringify(v));
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v.trim() : fallback);
const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const today = (): DateKey => dateOf(nowLocal());
const pct = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);

const SEARCHABLE: SearchType[] = ["note", "lecture", "course", "assignment", "exam", "task", "concept", "flashcard", "question", "formula", "lesson", "project", "paper", "attachment", "event"];

const tools: Tool[] = [
  {
    def: {
      name: "get_overview",
      description:
        "Overview of the student's studies: programmes (institution, level, dates, credits, target grade, progress) and every course (code, name, credits, status, current or final grade). Call this first for general questions about their studies.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    run: async () => {
      const [programmes, perf] = await Promise.all([listProgrammes(), getPerformance(1)]);
      const out = [];
      for (const p of programmes) {
        const courses = await listCourses({ programmeId: p.id });
        const active = perf?.programme.id === p.id ? perf : null;
        out.push({
          programme: p.name,
          institution: p.institutionName,
          level: p.level,
          status: p.status,
          startDate: p.startDate,
          endDate: p.endDate,
          totalCredits: p.totalCredits,
          creditUnit: p.creditUnit,
          targetGrade: p.targetGrade,
          gradingScale: { min: p.gradingScale.min, max: p.gradingScale.max, pass: p.gradingScale.pass },
          ...(active
            ? {
                average: active.stats.average != null ? formatGrade(p.gradingScale, active.stats.average) : null,
                projectedAverage: active.projectedAverage != null ? formatGrade(p.gradingScale, active.projectedAverage) : null,
                earnedCredits: active.stats.earnedCredits,
                completedCourses: active.stats.completedCount,
                inProgressCourses: active.stats.inProgressCount,
              }
            : {}),
          courses: courses.map((c) => {
            const cp = active?.courses.find((x) => x.course.id === c.id);
            return {
              id: c.id,
              code: c.code,
              name: c.name,
              credits: c.credits,
              status: c.status,
              lecturer: c.lecturer,
              finalGrade: c.finalGrade != null ? formatGrade(p.gradingScale, c.finalGrade) : null,
              currentPercent: pct(cp?.currentPercent),
            };
          }),
        });
      }
      return { content: json({ today: today(), programmes: out }), summary: "Looked at your programmes and courses", sources: [{ label: "My Studies", href: "/studies" }] };
    },
  },
  {
    def: {
      name: "search_my_data",
      description:
        "Full-text search across the student's notes, lectures, courses, assignments, exams, tasks, knowledge-base concepts, flashcards, questions, formulas, lessons, projects, papers, files and events. Use specific keywords (not whole sentences). Returns matches with ids for read_item.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords, e.g. 'gradient descent'" },
          types: { type: "array", items: { type: "string", enum: SEARCHABLE }, description: "Optional: only these kinds of items" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    run: async (args) => {
      const query = str(args.query).slice(0, 200);
      const types = Array.isArray(args.types) ? (args.types.filter((t) => SEARCHABLE.includes(t as SearchType)) as SearchType[]) : undefined;
      if (!query) return { content: json({ error: "query is required" }), summary: "Searched your data", sources: [] };
      // Every word must match; if that finds little, fall back to any single word.
      let hits = await search(query, { types: types?.length ? types : undefined, limit: 12 });
      if (hits.length < 3) {
        const words = query.split(/\s+/).filter((w) => w.length > 2);
        const seen = new Set(hits.map((h) => `${h.type}:${h.id}`));
        for (const w of words) for (const h of await search(w, { types: types?.length ? types : undefined, limit: 6 })) if (!seen.has(`${h.type}:${h.id}`) && seen.size < 12) (seen.add(`${h.type}:${h.id}`), hits.push(h));
      }
      hits = hits.slice(0, 12);
      const sources = await Promise.all(hits.slice(0, 6).map(async (h) => ({ label: h.title || "Untitled", href: await resultHref(h) })));
      return {
        content: json({ results: hits.map((h) => ({ type: h.type, id: h.id, title: h.title, snippet: h.snippet.replace(/\[\[|\]\]/g, "") })) }),
        summary: `Searched your data for “${query}” (${hits.length} ${hits.length === 1 ? "match" : "matches"})`,
        sources,
      };
    },
  },
  {
    def: {
      name: "read_item",
      description: "Reads one item in full by type and id (from search_my_data or get_overview): a note's text, a lecture, course, assignment, exam, concept, paper, project or lesson.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["note", "lecture", "course", "assignment", "exam", "concept", "paper", "project", "lesson"] },
          id: { type: "string" },
        },
        required: ["type", "id"],
        additionalProperties: false,
      },
    },
    run: async (args) => {
      const type = str(args.type);
      const id = str(args.id);
      const missing = { content: json({ error: `No ${type} with that id.` }), summary: `Tried to open a ${type}`, sources: [] };
      switch (type) {
        case "note": {
          const n = await getNote(id);
          if (!n) return missing;
          return { content: json({ title: n.title, updatedAt: n.updatedAt, text: clip(docToMarkdown(parseDoc(n.content)), 8000) }), summary: `Read your note “${n.title || "Untitled"}”`, sources: [{ label: n.title || "Untitled note", href: `/notes/${n.id}` }] };
        }
        case "lecture": {
          const l = await getLecture(id);
          if (!l) return missing;
          const notes = await listNotes({ lectureId: l.id, limit: 5 });
          return { content: json({ ...l, notes: notes.map((n) => ({ id: n.id, title: n.title, snippet: n.snippet })) }), summary: `Opened lecture “${l.title}”`, sources: [{ label: l.title, href: `/studies/lectures/${l.id}` }] };
        }
        case "course": {
          const c = await getCourse(id);
          if (!c) return missing;
          const standing = await getCourseStanding(c.id);
          return {
            content: json({ ...c, assessments: standing.items.map((i) => ({ title: i.title, kind: i.kind, weight: i.weight, percent: pct(i.percent), date: i.date })), currentPercent: pct(standing.standing.current) }),
            summary: `Opened course ${c.code ?? c.name}`,
            sources: [{ label: c.code ? `${c.code} · ${c.name}` : c.name, href: `/studies/courses/${c.id}` }],
          };
        }
        case "assignment": {
          const a = await getAssignment(id);
          if (!a) return missing;
          return { content: json(a), summary: `Opened assignment “${a.title}”`, sources: [{ label: a.title, href: `/studies/assignments/${a.id}` }] };
        }
        case "exam": {
          const e = await getExam(id);
          if (!e) return missing;
          return { content: json(e), summary: `Opened exam “${e.title}”`, sources: [{ label: e.title, href: `/studies/exams/${e.id}` }] };
        }
        case "concept": {
          const e = await getEntry(id);
          if (!e) return missing;
          return { content: json(e), summary: `Read the concept “${e.title}”`, sources: [{ label: e.title, href: `/knowledge/${e.id}` }] };
        }
        case "paper": {
          const p = await getPaper(id);
          if (!p) return missing;
          return { content: json(p), summary: `Read the paper “${p.title}”`, sources: [{ label: p.title, href: `/papers/${p.id}` }] };
        }
        case "project": {
          const p = await getProject(id);
          if (!p) return missing;
          const milestones = await listMilestones(p.id);
          return { content: json({ ...p, milestones }), summary: `Opened project “${p.title}”`, sources: [{ label: p.title, href: `/projects/${p.id}` }] };
        }
        case "lesson": {
          const l = await getLesson(id);
          if (!l) return missing;
          return { content: json({ title: l.title, summary: l.summary, content: clip(l.content, 8000) }), summary: `Read the lesson “${l.title}”`, sources: [{ label: l.title, href: `/practice/lessons/${l.id}` }] };
        }
        default:
          return { content: json({ error: `Unknown type ${type}` }), summary: "Tried to open an item", sources: [] };
      }
    },
  },
  {
    def: {
      name: "get_deadlines",
      description: "Assignments, exams and tasks due in a period (default: from today for 30 days), with course, date, status and weight.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "YYYY-MM-DD, default today" },
          days: { type: "integer", description: "How many days ahead, default 30, max 365" },
        },
        additionalProperties: false,
      },
    },
    run: async (args) => {
      const from = isDate(str(args.from)) ? str(args.from) : today();
      const days = num(args.days, 30, 1, 365);
      const lo = `${from}T00:00`;
      const hi = `${addDays(from, days)}T00:00`;
      const [assignments, exams, tasks] = await Promise.all([listAssignments(), listExams(), listTasks({ open: true })]);
      const a = assignments.filter((x) => x.dueAt && x.dueAt >= lo && x.dueAt < hi);
      const e = exams.filter((x) => x.startAt && x.startAt >= lo && x.startAt < hi);
      const t = tasks.filter((x) => x.dueAt && x.dueAt >= lo && x.dueAt < hi);
      return {
        content: json({
          from,
          to: addDays(from, days),
          assignments: a.map((x) => ({ id: x.id, title: x.title, course: x.courseName, due: x.dueAt, status: x.status, weight: x.weight })),
          exams: e.map((x) => ({ id: x.id, title: x.title, course: x.courseName, start: x.startAt, location: x.location, weight: x.weight, topics: x.topics.map((tp) => tp.text) })),
          tasks: t.map((x) => ({ title: x.title, due: x.dueAt, priority: x.priority, course: x.courseName, project: x.projectTitle })),
        }),
        summary: `Checked your deadlines for the next ${days} days`,
        sources: [...a.slice(0, 3).map((x) => ({ label: x.title, href: `/studies/assignments/${x.id}` })), ...e.slice(0, 3).map((x) => ({ label: x.title, href: `/studies/exams/${x.id}` }))],
      };
    },
  },
  {
    def: {
      name: "get_schedule",
      description: "Calendar items (classes, study sessions, work, exams, deadlines, events) between two dates. Default: today and the next 6 days.",
      parameters: {
        type: "object",
        properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD (inclusive), at most 62 days after from" } },
        additionalProperties: false,
      },
    },
    run: async (args) => {
      const from = isDate(str(args.from)) ? str(args.from) : today();
      let to = isDate(str(args.to)) ? str(args.to) : addDays(from, 6);
      if (to < from) to = from;
      if (to > addDays(from, 62)) to = addDays(from, 62);
      const items = await getCalendarItems(from, to);
      return {
        content: json({ from, to, items: items.slice(0, 120).map((i) => ({ type: i.type, title: i.title, start: i.start, end: i.end, allDay: i.allDay, location: i.location, course: i.courseCode })) }),
        summary: from === to ? `Looked at your calendar for ${from}` : `Looked at your calendar from ${from} to ${to}`,
        sources: [{ label: "Calendar", href: "/calendar" }],
      };
    },
  },
  {
    def: {
      name: "get_grades",
      description: "Grades and standing for the active programme: overall and projected average, each course's current percentage, what is needed for the target, assignment and exam averages, and upcoming weighted work.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    run: async () => {
      const p = await getPerformance(1);
      if (!p) return { content: json({ error: "No active programme yet." }), summary: "Checked your grades", sources: [] };
      const scale = p.programme.gradingScale;
      return {
        content: json({
          programme: p.programme.name,
          average: p.stats.average != null ? formatGrade(scale, p.stats.average) : null,
          projectedAverage: p.projectedAverage != null ? formatGrade(scale, p.projectedAverage) : null,
          target: p.programme.targetGrade,
          assignmentAveragePercent: pct(p.assignmentAverage),
          examAveragePercent: pct(p.examAverage),
          overdue: p.overdueCount,
          courses: p.courses.map((c) => ({
            course: c.course.code ? `${c.course.code} ${c.course.name}` : c.course.name,
            status: c.course.status,
            currentPercent: pct(c.currentPercent),
            grade: c.effectiveGrade != null ? formatGrade(scale, c.effectiveGrade) : null,
            requiredPercentOnRemaining: pct(c.requiredForTarget),
            targetReachable: c.targetReachable,
            gradedWeight: c.gradedWeight,
            attendancePercent: c.attendanceRate != null ? Math.round(c.attendanceRate * 100) : null,
          })),
          upcoming: p.upcoming.slice(0, 8),
        }),
        summary: "Checked your grades",
        sources: [{ label: "Grades & performance", href: "/grades" }],
      };
    },
  },
  {
    def: {
      name: "get_study_stats",
      description: "How much the student has studied: minutes today, this week, this month, total, streak, and time per course over the last 14 days.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    run: async () => {
      const [p, sessions] = await Promise.all([getPerformance(1), listStudySessions({ since: addDays(today(), -13) })]);
      const perCourse = new Map<string, number>();
      for (const s of sessions) perCourse.set(s.courseName ?? s.topic ?? "General", (perCourse.get(s.courseName ?? s.topic ?? "General") ?? 0) + s.minutes);
      return {
        content: json({ totalsMinutes: p?.study ?? null, last14DaysByCourseMinutes: Object.fromEntries(perCourse) }),
        summary: "Looked at your study time",
        sources: [{ label: "Study", href: "/study" }],
      };
    },
  },
  {
    def: {
      name: "get_review_status",
      description: "Spaced-repetition and mastery status: flashcards and questions due today, and the weakest or least-practised topics.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    run: async () => {
      const [due, mastery] = await Promise.all([dueCounts(today()), topicMastery(today())]);
      const weakest = mastery
        .filter((m) => m.mastery != null)
        .sort((a, b) => a.mastery! - b.mastery!)
        .slice(0, 10)
        .map((m) => ({ topic: m.name, masteryPercent: Math.round(m.mastery! * 100), answers: m.attempts, reviews: m.reviews }));
      const unpractised = mastery.filter((m) => m.mastery == null).slice(0, 10).map((m) => m.name);
      return { content: json({ due, weakest, notPractisedYet: unpractised }), summary: "Checked what's due for review", sources: [{ label: "Practice", href: "/practice?tab=mastery" }] };
    },
  },
  {
    def: {
      name: "list_tasks",
      description: "The student's tasks (to-dos) with due dates, priority, course and project.",
      parameters: { type: "object", properties: { status: { type: "string", enum: ["open", "all"], description: "Default open" } }, additionalProperties: false },
    },
    run: async (args) => {
      const tasks = await listTasks(args.status === "all" ? {} : { open: true });
      return {
        content: json({ tasks: tasks.slice(0, 80).map((t) => ({ title: t.title, status: t.status, due: t.dueAt, priority: t.priority, course: t.courseName, project: t.projectTitle, estimateMinutes: t.estimatedMinutes })) }),
        summary: `Looked at your ${args.status === "all" ? "" : "open "}tasks`,
        sources: [{ label: "Tasks", href: "/tasks" }],
      };
    },
  },
];

export const TOOL_DEFS: ToolDef[] = tools.map((t) => t.def);

/** Runs a tool call from the model. Unknown tools and failures come back as an error the model can read. */
export async function runTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tool = tools.find((t) => t.def.name === name);
  if (!tool) return { content: json({ error: `Unknown tool ${name}` }), summary: `Tried an unknown tool (${name})`, sources: [] };
  try {
    return await tool.run(args);
  } catch (err) {
    return { content: json({ error: err instanceof Error ? err.message : String(err) }), summary: `Couldn't ${tool.def.name.replace(/_/g, " ")}`, sources: [] };
  }
}

