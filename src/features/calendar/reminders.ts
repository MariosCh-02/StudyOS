/**
 * Which calendar items need a notification right now.
 * Pure so it can be tested; the scheduler (useReminders) calls it periodically.
 */
import { EVENT_TYPE_META, type EventType } from "@/domain/conflicts";
import { absMinutes, addDays, dateOf, timeOf, type LocalDateTime } from "@/domain/time";

export interface ReminderItem {
  key: string;
  type: EventType;
  title: string;
  start: LocalDateTime;
  allDay: boolean;
  location: string | null;
}

export interface Reminder {
  /** Stable id so each reminder fires once. */
  id: string;
  title: string;
  body: string;
}

/** Types that get a "starting soon" reminder. Work shifts are left out on purpose. */
const SOON: ReadonlySet<EventType> = new Set(["class", "study", "exam", "internship", "research", "personal"]);

export function dueReminders(items: ReminderItem[], now: LocalDateTime, leadMinutes: number, sent: ReadonlySet<string>): Reminder[] {
  const nowMin = absMinutes(now);
  const out: Reminder[] = [];
  for (const i of items) {
    const meta = EVENT_TYPE_META[i.type];
    if (i.allDay) {
      // All-day exams/deadlines: one heads-up at 18:00 the evening before.
      if ((i.type === "exam" || i.type === "assignment") && now >= `${addDays(dateOf(i.start), -1)}T18:00` && now < i.start) {
        const id = `${i.key}:eve`;
        if (!sent.has(id)) out.push({ id, title: `${meta.emoji} Tomorrow: ${i.title}`, body: meta.label });
      }
      continue;
    }
    const until = absMinutes(i.start) - nowMin;
    if (SOON.has(i.type) && until >= 0 && until <= leadMinutes) {
      const id = `${i.key}:soon`;
      if (!sent.has(id)) {
        const when = until === 0 ? "now" : `in ${until} min`;
        out.push({ id, title: `${meta.emoji} ${i.title} ${until === 0 ? "is starting" : "starts " + when}`, body: [timeOf(i.start), i.location].filter(Boolean).join(" · ") });
      }
    }
    // Timed deadlines: a day ahead and two hours ahead.
    if (i.type === "assignment") {
      const window = until >= 0 && until <= 120 ? "2h" : until > 120 && until <= 1440 ? "1d" : null;
      const id = window && `${i.key}:${window}`;
      if (id && !sent.has(id)) out.push({ id, title: `${meta.emoji} ${i.title.replace(/^Due: /, "")} is due in ${until < 60 ? `${until} min` : `${Math.round(until / 60)} h`}`, body: `Due ${dateOf(i.start)} ${timeOf(i.start)}` });
    }
    // Timed exams also get a reminder the day before.
    if (i.type === "exam" && until > leadMinutes && until <= 24 * 60) {
      const id = `${i.key}:day`;
      if (!sent.has(id)) out.push({ id, title: `${meta.emoji} Exam tomorrow: ${i.title}`, body: [timeOf(i.start), i.location].filter(Boolean).join(" · ") });
    }
  }
  return out;
}
