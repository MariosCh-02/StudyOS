/**
 * Ask My Studies: recognises common questions about your own data.
 * Pure parsing; answers are looked up locally by services/ask.ts.
 */
import { addDays, addMonths, isoWeekday, startOfMonth, type DateKey } from "./time";

export type Intent =
  | { kind: "examWhen"; subject: string | null }
  | { kind: "due"; from: DateKey; to: DateKey; label: string }
  | { kind: "grade"; item: string }
  | { kind: "tagged"; tag: string }
  | { kind: "notReviewed" }
  | { kind: "wroteAbout"; topic: string }
  | { kind: "nextClass" }
  | { kind: "average" }
  | { kind: "openTasks" }
  | { kind: "search"; text: string };

const STOPWORDS = new Set(
  "a an the my me i is are was were what when where which who how do did does have has had about on in at of for to from with and or any all show tell find list everything anything something there this that these those please".split(" "),
);

/** Content words of a question, for a fallback search. */
export function keywords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .join(" ");
}

const clean = (s: string) => s.replace(/[?.!]+$/g, "").replace(/^(the|my)\s+/i, "").trim();

function dueRange(q: string, today: DateKey): { from: DateKey; to: DateKey; label: string } {
  if (/\btoday\b/.test(q)) return { from: today, to: today, label: "today" };
  if (/\btomorrow\b/.test(q)) return { from: addDays(today, 1), to: addDays(today, 1), label: "tomorrow" };
  if (/\bnext week\b/.test(q)) {
    const start = addDays(today, 8 - isoWeekday(today));
    return { from: start, to: addDays(start, 6), label: "next week" };
  }
  if (/\b(this|current) week\b|\bweek\b/.test(q)) return { from: today, to: addDays(today, 7 - isoWeekday(today)), label: "this week" };
  if (/\bnext month\b/.test(q)) {
    const start = addMonths(startOfMonth(today), 1);
    return { from: start, to: addDays(addMonths(start, 1), -1), label: "next month" };
  }
  if (/\b(this|current) month\b|\bmonth\b/.test(q)) return { from: today, to: addDays(addMonths(startOfMonth(today), 1), -1), label: "this month" };
  return { from: today, to: addDays(today, 14), label: "in the next two weeks" };
}

export function parseQuestion(question: string, today: DateKey): Intent {
  const q = question.trim().toLowerCase();

  let m = /when(?:'s| is| are)?\s+(?:my |the )?(.*?)\s*(?:exam|exams|test|midterm|final)\b/.exec(q);
  if (m && /\b(exam|test|midterm|final)/.test(q)) return { kind: "examWhen", subject: clean(m[1] ?? "") || null };

  if (/\b(due|deadline|deadlines|assignments? (?:are|is) due)\b/.test(q) && /\b(what|which|any|list|show)\b/.test(q)) return { kind: "due", ...dueRange(q, today) };

  m = /\b(?:grade|score|mark|result)s?\b.*?\b(?:on|in|for)\s+(.+)$/.exec(q);
  if (m) return { kind: "grade", item: clean(m[1]!) };

  m = /(?:marked|tagged|flagged|labelled|labeled)(?:\s+(?:as|with))?\s+#?([\p{L}\p{N}_-]+)/u.exec(q) ?? /#([\p{L}\p{N}_-]+)/u.exec(q);
  if (m) return { kind: "tagged", tag: m[1]! };

  if (/\b(not|haven'?t|never|n't)\b.*\breview/.test(q) || /\bneed(?:s|ing)? (?:review|revision)\b/.test(q) || /\bweak(?:est)? topics?\b/.test(q)) return { kind: "notReviewed" };

  m = /\b(?:write|wrote|written|note|notes|noted)\b.*?\b(?:about|on)\s+(.+)$/.exec(q);
  if (m) return { kind: "wroteAbout", topic: clean(m[1]!) };

  if (/\bnext\b.*\b(class|lecture)\b/.test(q)) return { kind: "nextClass" };
  if (/\b(gpa|average|grades?)\b/.test(q) && /\b(my|current|what)\b/.test(q)) return { kind: "average" };
  if (/\b(tasks?|to-?dos?)\b/.test(q)) return { kind: "openTasks" };

  return { kind: "search", text: keywords(question) };
}
