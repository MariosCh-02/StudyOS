/**
 * Wall-clock date/time arithmetic.
 *
 * Calendar data is stored as local wall-clock strings ('YYYY-MM-DD',
 * 'HH:MM', 'YYYY-MM-DDTHH:MM'). All arithmetic here works on whole days and
 * minutes, independent of the machine's time zone and daylight saving.
 */

export type DateKey = string;
export type TimeOfDay = string;
export type LocalDateTime = string;

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a date key. */
export function dayNumber(key: DateKey): number {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNumber(n: number): DateKey {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export const addDays = (key: DateKey, n: number): DateKey => fromDayNumber(dayNumber(key) + n);

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(key: DateKey): number {
  const day = new Date(dayNumber(key) * DAY_MS).getUTCDay();
  return day === 0 ? 7 : day;
}

/** First day of the week containing `key`; weeks start on Monday (1) or Sunday (7). */
export function startOfWeek(key: DateKey, weekStart: 1 | 7 = 1): DateKey {
  const wd = isoWeekday(key);
  const offset = weekStart === 1 ? wd - 1 : wd % 7;
  return addDays(key, -offset);
}

export function startOfMonth(key: DateKey): DateKey {
  return `${key.slice(0, 7)}-01`;
}

export function addMonths(key: DateKey, n: number): DateKey {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const d = Math.min(Number(key.slice(8, 10)), lastDay);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export const isTime = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const isLocalDateTime = (s: string): boolean => /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function timeToMinutes(t: TimeOfDay): number {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

export function minutesToTime(min: number): TimeOfDay {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export const dateOf = (dt: LocalDateTime): DateKey => dt.slice(0, 10);
export const timeOf = (dt: LocalDateTime): TimeOfDay => dt.slice(11, 16);
export const joinDateTime = (d: DateKey, t: TimeOfDay): LocalDateTime => `${d}T${t}`;

/** Minutes since 1970-01-01T00:00 (wall clock). */
export const absMinutes = (dt: LocalDateTime): number => dayNumber(dateOf(dt)) * 1440 + timeToMinutes(timeOf(dt));

export const fromAbsMinutes = (n: number): LocalDateTime => joinDateTime(fromDayNumber(Math.floor(n / 1440)), minutesToTime(n));

export const addMinutes = (dt: LocalDateTime, n: number): LocalDateTime => fromAbsMinutes(absMinutes(dt) + n);

export const diffMinutes = (from: LocalDateTime, to: LocalDateTime): number => absMinutes(to) - absMinutes(from);

/** The current local wall-clock time. */
export function nowLocal(d: Date = new Date()): LocalDateTime {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converts a wall-clock time on this machine to a real instant. */
export function toInstant(dt: LocalDateTime): Date {
  const [y, mo, d] = dateOf(dt).split("-").map(Number) as [number, number, number];
  const [h, mi] = timeOf(dt).split(":").map(Number) as [number, number];
  return new Date(y, mo - 1, d, h, mi);
}

export function formatDuration(minutes: number): string {
  const total = Math.round(Math.abs(minutes));
  const sign = minutes < 0 && total > 0 ? "-" : "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${sign}${h} h ${m} min`;
  return h ? `${sign}${h} h` : `${sign}${m} min`;
}

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
