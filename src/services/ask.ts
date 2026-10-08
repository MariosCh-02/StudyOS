/**
 * Ask My Studies: answers questions from locally stored data only.
 * If nothing relevant is stored, it says so instead of guessing.
 */
import { parseQuestion, type Intent } from "@/domain/askIntents";
import { formatGrade } from "@/domain/grading";
import { percentOf } from "@/domain/assessment";
import { dateOf, nowLocal, timeOf, type DateKey } from "@/domain/time";
import { formatDate } from "@/domain/dates";
import { getDb } from "@/lib/db";
import { listAssignments, listExams } from "./assessments";
import { getCalendarItems } from "./calendar";
import { getPerformance } from "./performance";
import { resultHref, search, SEARCH_TYPE_LABELS } from "./search";
import { itemsWithTag } from "./tags";
import { listTasks } from "./tracking";
import { topicMastery } from "./practice";

export const NOT_FOUND = "I couldn't find this in your StudyOS data.";

export interface AnswerItem {
  label: string;
  detail?: string;
  href?: string;
}

export interface Answer {
  found: boolean;
  text: string;
  items: AnswerItem[];
  intent: Intent["kind"];
}

const when = (dt: string) => `${formatDate(dateOf(dt), { weekday: "long", day: "numeric", month: "long", year: "numeric" })} at ${timeOf(dt)}`;
const matches = (haystack: string, needle: string) => {
  const words = needle.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const h = haystack.toLowerCase();
  return words.length > 0 && words.every((w) => h.includes(w));
};

const notFound = (intent: Intent["kind"], text = NOT_FOUND): Answer => ({ found: false, text, items: [], intent });

export async function ask(question: string, today: DateKey = dateOf(nowLocal())): Promise<Answer> {
  const intent = parseQuestion(question, today);
  const now = nowLocal();

  switch (intent.kind) {
    case "examWhen": {
      const exams = (await listExams()).filter((e) => e.startAt);
      const subject = intent.subject;
      const hits = subject ? exams.filter((e) => matches(`${e.title} ${e.courseName} ${e.courseCode ?? ""}`, subject)) : exams;
      const upcoming = hits.filter((e) => e.startAt! >= now).sort((a, b) => a.startAt!.localeCompare(b.startAt!));
      const list = upcoming.length ? upcoming : hits.sort((a, b) => b.startAt!.localeCompare(a.startAt!)).slice(0, 3);
      if (!list.length) return notFound(intent.kind);
      const first = list[0]!;
      return {
        found: true,
        intent: intent.kind,
        text: upcoming.length
          ? `Your ${first.title} (${first.courseName}) is on **${when(first.startAt!)}**${first.location ? ` in ${first.location}` : ""}.`
          : `I found no upcoming exam${subject ? ` for “${subject}”` : ""}; the most recent was ${first.title} on ${when(first.startAt!)}.`,
        items: list.slice(0, 5).map((e) => ({ label: e.title, detail: `${e.courseName} · ${when(e.startAt!)}`, href: `/studies/exams/${e.id}` })),
      };
    }

    case "due": {
      const from = `${intent.from}T00:00`;
      const to = `${intent.to}T23:59`;
      const assignments = (await listAssignments()).filter((a) => a.dueAt && a.dueAt >= from && a.dueAt <= to);
      const tasks = (await listTasks({ open: true })).filter((t) => t.dueAt && t.dueAt >= from && t.dueAt <= to);
      if (!assignments.length && !tasks.length) return { found: true, intent: intent.kind, text: `Nothing is due ${intent.label}.`, items: [] };
      const open = assignments.filter((a) => a.status === "not_started" || a.status === "in_progress");
      return {
        found: true,
        intent: intent.kind,
        text: `${assignments.length} assignment${assignments.length === 1 ? "" : "s"}${open.length !== assignments.length ? ` (${open.length} still open)` : ""} and ${tasks.length} task${tasks.length === 1 ? "" : "s"} due ${intent.label}.`,
        items: [
          ...assignments.map((a) => ({ label: a.title, detail: `${a.courseName} · due ${when(a.dueAt!)}${a.status === "submitted" || a.status === "graded" ? " · submitted" : ""}`, href: `/studies/assignments/${a.id}` })),
          ...tasks.map((t) => ({ label: t.title, detail: `Task · due ${when(t.dueAt!)}`, href: "/tasks" })),
        ],
      };
    }

    case "grade": {
      const [assignments, exams] = await Promise.all([listAssignments(), listExams()]);
      const items = [
        ...assignments.map((a) => ({ kind: "assignment", id: a.id, title: a.title, course: a.courseName, score: a.score, max: a.maxScore })),
        ...exams.map((e) => ({ kind: "exam", id: e.id, title: e.title, course: e.courseName, score: e.score, max: e.maxScore })),
      ].filter((i) => matches(`${i.title} ${i.course}`, intent.item));
      if (!items.length) return notFound(intent.kind);
      const graded = items.filter((i) => i.score != null);
      const first = graded[0] ?? items[0]!;
      const pct = percentOf(first.score, first.max);
      return {
        found: true,
        intent: intent.kind,
        text:
          first.score != null
            ? `You got **${first.score}/${first.max}**${pct != null ? ` (${pct.toFixed(1)}%)` : ""} on ${first.title} (${first.course}).`
            : `${first.title} (${first.course}) hasn't been graded in StudyOS yet.`,
        items: items.slice(0, 5).map((i) => ({
          label: i.title,
          detail: `${i.course} · ${i.score != null ? `${i.score}/${i.max}` : "not graded"}`,
          href: `/studies/${i.kind === "exam" ? "exams" : "assignments"}/${i.id}`,
        })),
      };
    }

    case "tagged": {
      const items = await itemsWithTag(intent.tag);
      if (!items.length) return notFound(intent.kind, `${NOT_FOUND} Nothing is tagged #${intent.tag}.`);
      const out: AnswerItem[] = [];
      for (const i of items) out.push({ label: i.title, detail: SEARCH_TYPE_LABELS[i.type as keyof typeof SEARCH_TYPE_LABELS] ?? i.type, href: await resultHref({ type: i.type as never, id: i.id }) });
      return { found: true, intent: intent.kind, text: `${items.length} item${items.length === 1 ? " is" : "s are"} tagged #${intent.tag}.`, items: out };
    }

    case "notReviewed": {
      const db = await getDb();
      const lectures = await db.select<{ id: string; title: string; number: number | null; status: string; course: string }>(
        `SELECT l.id, l.title, l.number, l.revision_status AS status, c.name AS course FROM lectures l JOIN courses c ON c.id = l.course_id
         WHERE l.deleted_at IS NULL AND c.deleted_at IS NULL AND l.revision_status IN ('not_reviewed', 'needs_review')
         ORDER BY l.revision_status DESC, l.date`,
      );
      const weak = (await topicMastery(today)).filter((t) => t.mastery != null && t.mastery < 50).slice(0, 8);
      if (!lectures.length && !weak.length) return { found: true, intent: intent.kind, text: "Everything is reviewed: no lectures waiting for review and no weak topics.", items: [] };
      return {
        found: true,
        intent: intent.kind,
        text: `${lectures.length} lecture${lectures.length === 1 ? "" : "s"} not yet reviewed${weak.length ? ` and ${weak.length} weak topic${weak.length === 1 ? "" : "s"} (mastery under 50%)` : ""}.`,
        items: [
          ...lectures.slice(0, 15).map((l) => ({ label: l.number != null ? `Lecture ${l.number}: ${l.title}` : l.title, detail: `${l.course} · ${l.status === "needs_review" ? "needs review" : "not reviewed"}`, href: `/studies/lectures/${l.id}` })),
          ...weak.map((t) => ({ label: t.name, detail: `Topic · mastery ${t.mastery}%`, href: `/practice/quiz?topic=${t.topicId}&title=${encodeURIComponent(t.name)}` })),
        ],
      };
    }

    case "wroteAbout": {
      const hits = await search(intent.topic, { types: ["note", "lecture", "concept"], limit: 10 });
      if (!hits.length) return notFound(intent.kind);
      const out: AnswerItem[] = [];
      for (const h of hits) out.push({ label: h.title || "Untitled", detail: h.snippet, href: await resultHref(h) });
      return { found: true, intent: intent.kind, text: `You wrote about “${intent.topic}” in ${hits.length} place${hits.length === 1 ? "" : "s"}:`, items: out };
    }

    case "nextClass": {
      const items = (await getCalendarItems(today, dateOf(nowLocal(new Date(Date.now() + 14 * 86_400_000))))).filter((i) => i.type === "class" && i.start >= now);
      const next = items[0];
      if (!next) return notFound(intent.kind, `${NOT_FOUND} No classes are scheduled in the next two weeks.`);
      return {
        found: true,
        intent: intent.kind,
        text: `Your next class is **${next.title}** on ${when(next.start)}${next.location ? ` in ${next.location}` : ""}.`,
        items: items.slice(0, 5).map((i) => ({ label: i.title, detail: `${when(i.start)}${i.location ? ` · ${i.location}` : ""}`, href: "/calendar" })),
      };
    }

    case "average": {
      const p = await getPerformance();
      if (!p || (p.stats.average == null && p.projectedAverage == null)) return notFound(intent.kind, `${NOT_FOUND} No grades are recorded yet.`);
      const scale = p.programme.gradingScale;
      const parts = [
        p.stats.average != null ? `Your current average is **${formatGrade(scale, p.stats.average)}**` : `You have no final grades yet; your projected average is **${formatGrade(scale, p.projectedAverage)}**`,
        p.programme.targetGrade != null ? `your target is ${formatGrade(scale, p.programme.targetGrade)}` : null,
      ].filter(Boolean);
      return { found: true, intent: intent.kind, text: `${parts.join("; ")}.`, items: [{ label: "Grades & performance", href: "/grades" }] };
    }

    case "openTasks": {
      const tasks = await listTasks({ open: true });
      if (!tasks.length) return { found: true, intent: intent.kind, text: "You have no open tasks.", items: [] };
      return {
        found: true,
        intent: intent.kind,
        text: `You have ${tasks.length} open task${tasks.length === 1 ? "" : "s"}.`,
        items: tasks.slice(0, 10).map((t) => ({ label: t.title, detail: t.dueAt ? `due ${when(t.dueAt)}` : "no due date", href: "/tasks" })),
      };
    }

    case "search": {
      if (!intent.text.trim()) return notFound(intent.kind);
      const hits = await search(intent.text, { limit: 10 });
      if (!hits.length) return notFound(intent.kind);
      const out: AnswerItem[] = [];
      for (const h of hits) out.push({ label: h.title || "Untitled", detail: `${SEARCH_TYPE_LABELS[h.type]} · ${h.snippet}`, href: await resultHref(h) });
      return { found: true, intent: intent.kind, text: "Here's what I found in your StudyOS data:", items: out };
    }
  }
}
