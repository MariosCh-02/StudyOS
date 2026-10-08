import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { AlertTriangle, CalendarRange, ChevronLeft, ChevronRight, Download, FileUp, Plus, Repeat } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { ErrorState, Spinner } from "@/components/ui/Feedback";
import { useCalendarItems, useSettings } from "@/hooks/queries";
import { findConflicts } from "@/domain/conflicts";
import { addDays, addMonths, dateOf, nowLocal, startOfMonth, startOfWeek, type DateKey, type LocalDateTime } from "@/domain/time";
import { formatDate } from "@/domain/dates";
import { pickSavePath, writeTextFile } from "@/lib/native";
import type { CalendarItem } from "@/services/calendar";
import { exportIcs } from "@/services/icsTransfer";
import { AgendaView, MonthView } from "./MonthAgenda";
import { EventForm } from "./EventForm";
import { ImportDialog } from "./ImportDialog";
import { ItemDialog } from "./ItemDialog";
import { TimeGrid } from "./TimeGrid";

type View = "day" | "week" | "month" | "agenda";
const VIEWS: { id: View; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "agenda", label: "Agenda" },
];
const AGENDA_DAYS = 30;

function storedView(): View {
  try {
    const v = localStorage.getItem("studyos.calendarView");
    return VIEWS.some((x) => x.id === v) ? (v as View) : "week";
  } catch {
    return "week";
  }
}

export default function CalendarPage() {
  const settings = useSettings();
  const weekStart = settings.data?.weekStart === "sunday" ? 7 : 1;
  const today = dateOf(nowLocal());
  const [view, setView] = useState<View>(storedView);
  const [anchor, setAnchor] = useState<DateKey>(today);
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [newAt, setNewAt] = useState<LocalDateTime | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("studyos.calendarView", view);
    } catch {
      // Preference only.
    }
  }, [view]);

  const range = useMemo(() => {
    if (view === "day") return { from: anchor, to: anchor };
    if (view === "week") {
      const from = startOfWeek(anchor, weekStart);
      return { from, to: addDays(from, 6) };
    }
    if (view === "month") {
      const from = startOfWeek(startOfMonth(anchor), weekStart);
      return { from, to: addDays(from, 41) };
    }
    return { from: anchor, to: addDays(anchor, AGENDA_DAYS - 1) };
  }, [view, anchor, weekStart]);

  // One extra day before the range so overnight items show where they end.
  const items = useCalendarItems(addDays(range.from, -1), range.to);
  const list = useMemo(() => items.data ?? [], [items.data]);
  const conflicts = useMemo(() => findConflicts(list), [list]);
  const visibleConflicts = conflicts.filter((c) => dateOf(c.b.start) >= range.from && dateOf(c.b.start) <= range.to);
  const conflictKeys = useMemo(() => new Set(conflicts.flatMap((c) => [c.a.key, c.b.key])), [conflicts]);

  const step = (dir: 1 | -1) =>
    setAnchor((a) => (view === "day" ? addDays(a, dir) : view === "week" ? addDays(a, 7 * dir) : view === "month" ? addMonths(a, dir) : addDays(a, AGENDA_DAYS * dir)));

  const title =
    view === "day"
      ? formatDate(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : view === "week"
        ? `${formatDate(range.from, { day: "numeric", month: "short" })} – ${formatDate(range.to, { day: "numeric", month: "short", year: "numeric" })}`
        : view === "month"
          ? formatDate(anchor, { month: "long", year: "numeric" })
          : `Next ${AGENDA_DAYS} days from ${formatDate(anchor, { day: "numeric", month: "short" })}`;

  const exportCalendar = async () => {
    setExportMsg(null);
    try {
      const path = await pickSavePath("StudyOS calendar.ics", "ics", "Calendar");
      if (!path) return;
      await writeTextFile(path, await exportIcs());
      setExportMsg(`Saved to ${path}`);
    } catch (err) {
      setExportMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const days = view === "day" ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(range.from, i));

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h1 className="mr-2 flex items-center gap-2 text-lg font-semibold tracking-tight">
          <CalendarRange className="size-5 text-accent" aria-hidden /> Calendar
        </h1>
        <Button size="sm" onClick={() => setAnchor(today)}>
          Today
        </Button>
        <IconButton label="Previous" onClick={() => step(-1)}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <IconButton label="Next" onClick={() => step(1)}>
          <ChevronRight className="size-4" />
        </IconButton>
        <span className="min-w-0 truncate text-sm font-medium">{title}</span>
        <span className="flex-1" />
        {visibleConflicts.length > 0 && (
          <button
            type="button"
            onClick={() => setSelected(visibleConflicts[0]!.b)}
            className="flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger"
          >
            <AlertTriangle className="size-3.5" aria-hidden />
            {visibleConflicts.length} schedule conflict{visibleConflicts.length === 1 ? "" : "s"}
          </button>
        )}
        <div role="tablist" aria-label="Calendar view" className="flex rounded-md border border-border p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              type="button"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={clsx("h-7 rounded px-2.5 text-xs font-medium", view === v.id ? "bg-accent-soft text-accent" : "text-muted hover:text-fg")}
            >
              {v.label}
            </button>
          ))}
        </div>
        <Link to="/timetable" className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg">
          <Repeat className="size-3.5" aria-hidden /> Timetable
        </Link>
        <IconButton label="Import .ics" onClick={() => setImporting(true)}>
          <FileUp className="size-4" />
        </IconButton>
        <IconButton label="Export .ics" onClick={() => void exportCalendar()}>
          <Download className="size-4" />
        </IconButton>
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
          New event
        </Button>
      </header>
      {exportMsg && (
        <p className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-1.5 text-xs text-muted">
          {exportMsg}
          <button type="button" className="underline" onClick={() => setExportMsg(null)}>
            Dismiss
          </button>
        </p>
      )}

      <div className="min-h-0 flex-1">
        {items.isPending ? (
          <Spinner />
        ) : items.error ? (
          <ErrorState error={items.error} onRetry={() => void items.refetch()} />
        ) : view === "month" ? (
          <MonthView
            gridStart={range.from}
            month={anchor.slice(0, 7)}
            items={list}
            conflictKeys={conflictKeys}
            onDayClick={(d) => {
              setAnchor(d);
              setView("day");
            }}
            onItemClick={setSelected}
          />
        ) : view === "agenda" ? (
          <AgendaView from={range.from} days={AGENDA_DAYS} items={list} conflictKeys={conflictKeys} onItemClick={setSelected} />
        ) : (
          <TimeGrid days={days} items={list} conflictKeys={conflictKeys} onSlotClick={setNewAt} onItemClick={setSelected} />
        )}
      </div>

      <ItemDialog item={selected} onClose={() => setSelected(null)} conflicts={conflicts} context={list} />
      <EventForm open={creating || newAt != null} defaultStart={newAt ?? undefined} onClose={() => {
        setCreating(false);
        setNewAt(null);
      }} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}
