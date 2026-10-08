import clsx from "clsx";
import { AlertTriangle, CalendarX } from "lucide-react";
import { EmptyState } from "@/components/ui/Feedback";
import { EVENT_TYPE_META } from "@/domain/conflicts";
import { addDays, dateOf, isoWeekday, nowLocal, timeOf, WEEKDAY_SHORT, type DateKey } from "@/domain/time";
import { formatDate } from "@/domain/dates";
import type { CalendarItem } from "@/services/calendar";
import { itemColor } from "./TimeGrid";

const onDay = (items: CalendarItem[], d: DateKey) => items.filter((i) => dateOf(i.start) === d || (i.allDay && dateOf(i.start) <= d && i.end > `${d}T00:00`));

interface MonthProps {
  /** First day shown (start of the week containing the 1st). */
  gridStart: DateKey;
  month: string; // YYYY-MM
  items: CalendarItem[];
  conflictKeys: ReadonlySet<string>;
  onDayClick: (d: DateKey) => void;
  onItemClick: (i: CalendarItem) => void;
}

export function MonthView({ gridStart, month, items, conflictKeys, onDayClick, onItemClick }: MonthProps) {
  const today = dateOf(nowLocal());
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  return (
    <div className="flex h-full flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {days.slice(0, 7).map((d) => (
          <div key={d} className="py-2 text-center text-[11px] font-medium tracking-wide text-muted uppercase">
            {WEEKDAY_SHORT[isoWeekday(d) - 1]}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const list = onDay(items, d);
          const inMonth = d.startsWith(month);
          return (
            <div key={d} className={clsx("flex min-h-0 flex-col border-r border-b border-border p-1", !inMonth && "bg-surface-2/40")}>
              <button
                type="button"
                onClick={() => onDayClick(d)}
                className={clsx(
                  "mb-0.5 flex size-6 items-center justify-center self-start rounded-full text-xs tabular-nums hover:bg-surface-2",
                  d === today ? "bg-accent font-semibold text-accent-fg hover:bg-accent" : inMonth ? "text-fg" : "text-subtle",
                )}
              >
                {Number(d.slice(8))}
              </button>
              <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden">
                {list.slice(0, 3).map((i) => (
                  <button
                    key={i.key}
                    type="button"
                    onClick={() => onItemClick(i)}
                    className="flex w-full items-center gap-1 truncate rounded px-1 text-left text-[11px] hover:bg-surface-2"
                  >
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: itemColor(i) }} />
                    {conflictKeys.has(i.key) && <AlertTriangle className="size-2.5 shrink-0 text-danger" aria-label="Conflict" />}
                    {!i.allDay && <span className="text-subtle tabular-nums">{timeOf(i.start)}</span>}
                    <span className="truncate">{i.title}</span>
                  </button>
                ))}
                {list.length > 3 && (
                  <button type="button" onClick={() => onDayClick(d)} className="px-1 text-[11px] text-muted hover:text-fg">
                    +{list.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface AgendaProps {
  from: DateKey;
  days: number;
  items: CalendarItem[];
  conflictKeys: ReadonlySet<string>;
  onItemClick: (i: CalendarItem) => void;
}

export function AgendaView({ from, days, items, conflictKeys, onItemClick }: AgendaProps) {
  const today = dateOf(nowLocal());
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i)).filter((d) => onDay(items, d).length > 0);
  if (dates.length === 0)
    return (
      <EmptyState icon={<CalendarX className="size-5" />} title="Nothing scheduled" description={`No events in the ${days} days from ${formatDate(from)}.`} />
    );
  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      {dates.map((d) => (
        <section key={d} className="mb-4">
          <h3 className={clsx("sticky top-0 z-10 bg-bg py-1 text-xs font-semibold tracking-wide uppercase", d === today ? "text-accent" : "text-muted")}>
            {d === today ? "Today · " : ""}
            {formatDate(d, { weekday: "long", day: "numeric", month: "long" })}
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {onDay(items, d).map((i) => (
              <li key={i.key}>
                <button type="button" onClick={() => onItemClick(i)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2">
                  <span className="w-24 shrink-0 text-xs text-muted tabular-nums">{i.allDay ? "All day" : `${timeOf(i.start)}–${timeOf(i.end)}`}</span>
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: itemColor(i) }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-sm">
                      {EVENT_TYPE_META[i.type].emoji} {i.title}
                      {conflictKeys.has(i.key) && (
                        <span className="flex items-center gap-0.5 text-xs text-danger">
                          <AlertTriangle className="size-3" /> Conflict
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-subtle">
                      {[EVENT_TYPE_META[i.type].label, i.courseCode, i.location, i.moved ? "Rescheduled" : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
