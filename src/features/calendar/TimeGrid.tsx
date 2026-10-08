import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Repeat } from "lucide-react";
import { EVENT_TYPE_META } from "@/domain/conflicts";
import { dateOf, isoWeekday, joinDateTime, minutesToTime, nowLocal, timeOf, timeToMinutes, WEEKDAY_SHORT, type DateKey, type LocalDateTime } from "@/domain/time";
import type { CalendarItem } from "@/services/calendar";
import { layoutDay } from "./layout";

export const HOUR_PX = 48;

export const itemColor = (i: Pick<CalendarItem, "type" | "courseColor">) => i.courseColor ?? EVENT_TYPE_META[i.type].color;

interface Props {
  days: DateKey[];
  items: CalendarItem[];
  conflictKeys: ReadonlySet<string>;
  onSlotClick?: (start: LocalDateTime) => void;
  onItemClick: (item: CalendarItem) => void;
  /** Hide the date numbers (used by the timetable's weekly pattern). */
  weekdaysOnly?: boolean;
  /** Scroll position on first render, in hours. */
  initialHour?: number;
}

function useNow(): LocalDateTime {
  const [now, setNow] = useState(nowLocal);
  useEffect(() => {
    const t = setInterval(() => setNow(nowLocal()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Day/week grid: an all-day row, then 24 hour rows with positioned events. */
export function TimeGrid({ days, items, conflictKeys, onSlotClick, onItemClick, weekdaysOnly, initialHour = 7 }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const now = useNow();
  const today = dateOf(now);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = initialHour * HOUR_PX - 8;
  }, [initialHour]);

  const allDay = (d: DateKey) => items.filter((i) => i.allDay && dateOf(i.start) <= d && i.end > `${d}T00:00`);
  const hasAllDay = days.some((d) => allDay(d).length > 0);

  const slotFromClick = (d: DateKey, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = Math.floor(((e.clientY - rect.top) / HOUR_PX) * 2) * 30; // 30-minute steps
    onSlotClick?.(joinDateTime(d, minutesToTime(Math.min(minutes, 23 * 60 + 30))));
  };

  const cols = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Column headers */}
      <div className="grid shrink-0 border-b border-border" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => (
          <div key={d} className={clsx("py-2 text-center", d === today && !weekdaysOnly && "text-accent")}>
            <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{WEEKDAY_SHORT[isoWeekday(d) - 1]}</div>
            {!weekdaysOnly && <div className={clsx("text-lg font-semibold tabular-nums", d === today && "text-accent")}>{Number(d.slice(8))}</div>}
          </div>
        ))}
      </div>

      {hasAllDay && (
        <div className="grid shrink-0 border-b border-border" style={{ gridTemplateColumns: cols }}>
          <div className="py-1 pr-2 text-right text-[10px] text-subtle">all-day</div>
          {days.map((d) => (
            <div key={d} className="space-y-0.5 border-l border-border p-0.5">
              {allDay(d).map((i) => (
                <button
                  key={i.key}
                  type="button"
                  onClick={() => onItemClick(i)}
                  className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white"
                  style={{ background: itemColor(i) }}
                >
                  {i.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}>
          {/* Hour labels */}
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-subtle tabular-nums" style={{ top: h * HOUR_PX }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          {days.map((d) => {
            const blocks = layoutDay(items, d);
            return (
              <div
                key={d}
                className={clsx("relative border-l border-border", onSlotClick && "cursor-cell", d === today && !weekdaysOnly && "bg-accent-soft/20")}
                onClick={(e) => e.target === e.currentTarget && slotFromClick(d, e)}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/60" style={{ top: h * HOUR_PX }} />
                ))}

                {blocks.map(({ item: i, startMin, endMin, col, cols: n, clippedStart, clippedEnd }) => {
                  const short = endMin - startMin < 45;
                  const conflict = conflictKeys.has(i.key);
                  return (
                    <button
                      key={`${i.key}-${d}`}
                      type="button"
                      onClick={() => onItemClick(i)}
                      title={`${i.title} · ${timeOf(i.start)}–${timeOf(i.end)}${i.location ? ` · ${i.location}` : ""}`}
                      className={clsx(
                        "absolute overflow-hidden rounded-md border-l-[3px] px-1.5 text-left text-[11px] leading-tight shadow-sm transition-[filter] hover:brightness-110",
                        short ? "py-0" : "py-1",
                        conflict && "ring-2 ring-danger",
                        clippedStart && "rounded-t-none",
                        clippedEnd && "rounded-b-none",
                      )}
                      style={{
                        top: (startMin / 60) * HOUR_PX + 1,
                        height: ((endMin - startMin) / 60) * HOUR_PX - 2,
                        left: `calc(${(col / n) * 100}% + 2px)`,
                        width: `calc(${100 / n}% - 4px)`,
                        background: `color-mix(in srgb, ${itemColor(i)} 22%, var(--surface))`,
                        borderLeftColor: itemColor(i),
                      }}
                    >
                      <span className="flex items-center gap-1 font-medium text-fg">
                        {conflict && <AlertTriangle className="size-3 shrink-0 text-danger" aria-label="Schedule conflict" />}
                        <span className="truncate">
                          {EVENT_TYPE_META[i.type].emoji} {i.courseCode && i.type === "class" ? `${i.courseCode} · ` : ""}
                          {i.title}
                        </span>
                      </span>
                      {!short && (
                        <span className="flex items-center gap-1 truncate text-muted">
                          {timeOf(i.start)}–{timeOf(i.end)}
                          {i.location && ` · ${i.location}`}
                          {i.source === "series" && <Repeat className="size-2.5 shrink-0" aria-label="Repeats" />}
                        </span>
                      )}
                    </button>
                  );
                })}

                {d === today && !weekdaysOnly && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger"
                    style={{ top: (timeToMinutes(timeOf(now)) / 60) * HOUR_PX }}
                    aria-hidden
                  >
                    <span className="absolute -top-[5px] -left-[5px] size-2 rounded-full bg-danger" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
