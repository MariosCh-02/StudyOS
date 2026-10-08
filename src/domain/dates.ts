/** Local calendar date as YYYY-MM-DD. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00`);
  return !Number.isNaN(d.getTime()) && toDateKey(d) === value;
}

export function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function formatDate(key: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  if (!key) return "";
  const d = new Date(`${key}T00:00:00`);
  return Number.isNaN(d.getTime()) ? key : d.toLocaleDateString(undefined, opts);
}

export function formatDateRange(start: string | null, end: string | null): string {
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  if (start) return `From ${formatDate(start)}`;
  if (end) return `Until ${formatDate(end)}`;
  return "";
}

interface Dated {
  startDate: string | null;
  endDate: string | null;
}

/**
 * Picks the period containing `today`. If none contains it, picks the most
 * recently started period, or the first upcoming one when all are future.
 */
export function pickCurrentPeriod<T extends Dated>(periods: T[], today: string): T | null {
  if (periods.length === 0) return null;
  const containing = periods.filter(
    (p) => (p.startDate == null || p.startDate <= today) && (p.endDate == null || p.endDate >= today) && (p.startDate || p.endDate),
  );
  if (containing.length) return containing.sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))[0]!;
  const started = periods.filter((p) => p.startDate && p.startDate <= today);
  if (started.length) return started.sort((a, b) => b.startDate!.localeCompare(a.startDate!))[0]!;
  const upcoming = periods.filter((p) => p.startDate && p.startDate > today);
  if (upcoming.length) return upcoming.sort((a, b) => a.startDate!.localeCompare(b.startDate!))[0]!;
  return periods[periods.length - 1]!;
}
