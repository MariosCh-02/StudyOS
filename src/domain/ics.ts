/**
 * iCalendar (RFC 5545) import and export, covering what university timetables
 * and calendar apps use in practice: VEVENT with DTSTART/DTEND/DURATION,
 * all-day events, UTC and TZID times, weekly/daily RRULEs, EXDATE.
 *
 * Times with a TZID are taken as wall-clock times (StudyOS assumes the
 * timetable is in your own time zone); UTC times are converted to local.
 */
import { dateOfNthOccurrence, type WeeklyRule } from "./recurrence";
import { addDays, addMinutes, dateOf, diffMinutes, isoWeekday, nowLocal, timeOf, toInstant, type DateKey, type LocalDateTime } from "./time";

export interface IcsRRule {
  freq: string;
  interval: number;
  byDay: number[];
  /** Last allowed start, as local wall-clock time. */
  until: LocalDateTime | null;
  count: number | null;
}

export interface IcsEvent {
  uid: string;
  summary: string;
  location: string | null;
  description: string | null;
  start: LocalDateTime;
  end: LocalDateTime;
  allDay: boolean;
  rrule: IcsRRule | null;
  exdates: DateKey[];
  /** Present on overrides of a single recurring occurrence. */
  recurrenceId: DateKey | null;
  cancelled: boolean;
  /** The start was given in UTC (converted to local time at the first occurrence). */
  utc?: boolean;
}

export interface IcsParseResult {
  events: IcsEvent[];
  warnings: string[];
}

const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(text: string): string[] {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/).filter((l) => l.length > 0);
}

function parseLine(line: string): Prop | null {
  // NAME;PARAM=VALUE;PARAM="quoted:value":VALUE
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ":" && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...paramParts] = head.split(";");
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: (name ?? "").toUpperCase(), params, value };
}

export const unescapeText = (v: string): string => v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
export const escapeText = (v: string): string => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Parses an ICS date or date-time into a local wall-clock value. */
function parseDateValue(value: string, params: Record<string, string>): { dt: LocalDateTime; allDay: boolean; utc?: boolean } | null {
  const v = value.trim();
  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    return m ? { dt: `${m[1]}-${m[2]}-${m[3]}T00:00`, allDay: true } : null;
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  if (m[7]) {
    // UTC → this machine's local time.
    const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)));
    return { dt: nowLocal(d), allDay: false, utc: true };
  }
  return { dt: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`, allDay: false };
}

function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const minutes = +(m[2] ?? 0) * 10080 + +(m[3] ?? 0) * 1440 + +(m[4] ?? 0) * 60 + +(m[5] ?? 0);
  return m[1] === "-" ? -minutes : minutes;
}

function parseRRule(v: string): IcsRRule {
  const parts = Object.fromEntries(
    v.split(";").map((p) => {
      const [k, val] = p.split("=");
      return [(k ?? "").toUpperCase(), val ?? ""];
    }),
  );
  const until = parts.UNTIL ? parseDateValue(parts.UNTIL, {}) : null;
  // A date-only UNTIL includes that whole day.
  const untilDt = until ? (until.allDay ? `${dateOf(until.dt)}T23:59` : until.dt) : null;
  return {
    freq: (parts.FREQ ?? "").toUpperCase(),
    interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1),
    byDay: (parts.BYDAY ?? "")
      .split(",")
      .map((d) => DAY_CODES.indexOf(d.trim().slice(-2).toUpperCase()) + 1)
      .filter((d) => d > 0),
    until: untilDt,
    count: parts.COUNT ? Number(parts.COUNT) || null : null,
  };
}

export function parseIcs(text: string): IcsParseResult {
  const lines = unfold(text);
  const warnings: string[] = [];
  if (!lines.some((l) => l.toUpperCase().startsWith("BEGIN:VCALENDAR"))) {
    return { events: [], warnings: ["This doesn't look like a calendar (.ics) file."] };
  }
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> & { durationMin?: number } | null = null;
  let depth = 0; // nested components inside VEVENT (e.g. VALARM) are skipped
  let index = 0;

  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN" && p.value.toUpperCase() === "VEVENT") {
      cur = { exdates: [], rrule: null, recurrenceId: null, cancelled: false, location: null, description: null };
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (p.name === "BEGIN") {
      depth++;
      continue;
    }
    if (p.name === "END" && depth > 0) {
      depth--;
      continue;
    }
    if (depth > 0) continue;
    if (p.name === "END" && p.value.toUpperCase() === "VEVENT") {
      index++;
      if (!cur.start) {
        warnings.push(`Skipped event ${index} (“${cur.summary ?? "untitled"}”): no start time.`);
      } else {
        let end = cur.end;
        if (!end) {
          end = cur.durationMin != null ? addMinutes(cur.start, cur.durationMin) : cur.allDay ? `${addDays(dateOf(cur.start), 1)}T00:00` : addMinutes(cur.start, 60);
        }
        if (end <= cur.start) end = cur.allDay ? `${addDays(dateOf(cur.start), 1)}T00:00` : addMinutes(cur.start, 60);
        events.push({
          uid: cur.uid ?? `studyos-import-${index}-${cur.start}`,
          summary: cur.summary?.trim() || "Untitled event",
          location: cur.location ?? null,
          description: cur.description ?? null,
          start: cur.start,
          end,
          allDay: cur.allDay ?? false,
          rrule: cur.rrule ?? null,
          exdates: cur.exdates ?? [],
          recurrenceId: cur.recurrenceId ?? null,
          cancelled: cur.cancelled ?? false,
        });
      }
      cur = null;
      continue;
    }
    switch (p.name) {
      case "UID":
        cur.uid = p.value.trim();
        break;
      case "SUMMARY":
        cur.summary = unescapeText(p.value);
        break;
      case "LOCATION":
        cur.location = unescapeText(p.value) || null;
        break;
      case "DESCRIPTION":
        cur.description = unescapeText(p.value) || null;
        break;
      case "STATUS":
        cur.cancelled = p.value.trim().toUpperCase() === "CANCELLED";
        break;
      case "DTSTART": {
        const d = parseDateValue(p.value, p.params);
        if (d) {
          cur.start = d.dt;
          cur.allDay = d.allDay;
          cur.utc = d.utc;
        }
        break;
      }
      case "DTEND": {
        const d = parseDateValue(p.value, p.params);
        if (d) cur.end = d.dt;
        break;
      }
      case "DURATION":
        cur.durationMin = parseDuration(p.value) ?? undefined;
        break;
      case "RRULE":
        cur.rrule = parseRRule(p.value);
        break;
      case "EXDATE":
        for (const v of p.value.split(",")) {
          const d = parseDateValue(v, p.params);
          if (d) cur.exdates!.push(dateOf(d.dt));
        }
        break;
      case "RECURRENCE-ID": {
        const d = parseDateValue(p.value, p.params);
        if (d) cur.recurrenceId = dateOf(d.dt);
        break;
      }
    }
  }
  return { events, warnings };
}

/**
 * Converts an event's RRULE to a StudyOS weekly rule. Returns null (with a
 * reason) when the pattern can't be represented, e.g. monthly repeats.
 */
export function toWeeklyRule(e: IcsEvent): { rule: WeeklyRule } | { rule: null; reason: string } {
  const r = e.rrule;
  if (!r) return { rule: null, reason: "not recurring" };
  if (e.allDay) return { rule: null, reason: "all-day repeating events aren't supported" };
  const minutes = diffMinutes(e.start, e.end);
  if (minutes <= 0 || minutes >= 1440) return { rule: null, reason: "repeating events must be shorter than a day" };
  let weekdays: number[];
  if (r.freq === "WEEKLY") weekdays = r.byDay.length ? r.byDay : [isoWeekday(dateOf(e.start))];
  else if (r.freq === "DAILY" && r.interval === 1) weekdays = r.byDay.length ? r.byDay : [1, 2, 3, 4, 5, 6, 7];
  else return { rule: null, reason: `${r.freq.toLowerCase() || "unknown"} repeats aren't supported` };
  if (r.interval > 8) return { rule: null, reason: "repeats more than 8 weeks apart aren't supported" };

  const base = {
    weekdays: [...new Set(weekdays)].sort(),
    startTime: timeOf(e.start),
    endTime: timeOf(e.end),
    startDate: dateOf(e.start),
    intervalWeeks: r.freq === "WEEKLY" ? r.interval : 1,
  };
  // Last occurrence date: the last day whose start time is not after UNTIL.
  let endDate = r.until ? (timeOf(r.until) >= base.startTime ? dateOf(r.until) : addDays(dateOf(r.until), -1)) : null;
  if (r.count) endDate = dateOfNthOccurrence(base, r.count);
  return { rule: { ...base, endDate } };
}

// ------------------------------------------------------------------ export

export interface ExportEvent {
  uid: string;
  summary: string;
  location?: string | null;
  description?: string | null;
  start: LocalDateTime;
  end: LocalDateTime;
  allDay?: boolean;
  /** Weekly rule for recurring items. */
  rule?: WeeklyRule;
  exdates?: DateKey[];
  categories?: string;
}

const icsDate = (d: DateKey) => d.replace(/-/g, "");
/** UNTIL must be UTC when DTSTART has a TZID: end of the last local day, as UTC. */
const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const icsDateTime = (dt: LocalDateTime) => `${icsDate(dateOf(dt))}T${timeOf(dt).replace(":", "")}00`;

/** Folds a content line to 75 characters as required by RFC 5545. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`);
  return parts.join("\r\n");
}

export function generateIcs(events: ExportEvent[], opts: { calendarName: string; timeZone?: string; stamp?: string }): string {
  const tz = opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const stamp = opts.stamp ?? new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//StudyOS//StudyOS Calendar//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escapeText(opts.calendarName)}`, `X-WR-TIMEZONE:${tz}`];
  for (const e of events) {
    out.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`);
    if (e.allDay) {
      out.push(`DTSTART;VALUE=DATE:${icsDate(dateOf(e.start))}`, `DTEND;VALUE=DATE:${icsDate(dateOf(e.end))}`);
    } else {
      out.push(`DTSTART;TZID=${tz}:${icsDateTime(e.start)}`, `DTEND;TZID=${tz}:${icsDateTime(e.end)}`);
    }
    if (e.rule) {
      const parts = ["FREQ=WEEKLY"];
      if (e.rule.intervalWeeks > 1) parts.push(`INTERVAL=${e.rule.intervalWeeks}`);
      parts.push(`BYDAY=${e.rule.weekdays.map((d) => DAY_CODES[d - 1]).join(",")}`);
      if (e.rule.endDate) parts.push(`UNTIL=${utcStamp(toInstant(`${e.rule.endDate}T23:59`))}`);
      out.push(`RRULE:${parts.join(";")}`);
      for (const x of e.exdates ?? []) out.push(`EXDATE;TZID=${tz}:${icsDate(x)}T${e.rule.startTime.replace(":", "")}00`);
    }
    out.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.location) out.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) out.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.categories) out.push(`CATEGORIES:${escapeText(e.categories)}`);
    out.push("END:VEVENT");
  }
  out.push("END:VCALENDAR");
  return out.map(fold).join("\r\n") + "\r\n";
}
