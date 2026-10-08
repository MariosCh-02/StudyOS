import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, MapPin, NotebookPen, Pencil, Play, Repeat, RotateCcw, Trash2, User, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormModal, Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/Field";
import { useSaveMutation } from "@/hooks/queries";
import { EVENT_TYPE_META, suggestAlternatives, type Conflict } from "@/domain/conflicts";
import { addMinutes, dateOf, diffMinutes, formatDuration, joinDateTime, timeOf } from "@/domain/time";
import { formatDate } from "@/domain/dates";
import {
  cancelOccurrence,
  deleteEvent,
  deleteRecurring,
  endRecurringBefore,
  getEvent,
  getRecurring,
  moveOccurrence,
  restoreOccurrence,
  updateEvent,
  type CalendarEvent,
  type CalendarItem,
  type RecurringEvent,
} from "@/services/calendar";
import { getOrCreateLectureForDate } from "@/services/lectures";
import { EventForm } from "./EventForm";
import { RecurringForm } from "./RecurringForm";
import { itemColor } from "./TimeGrid";

function MoveOccurrenceForm({ item, open, onClose }: { item: CalendarItem; open: boolean; onClose: () => void }) {
  const [date, setDate] = useState(dateOf(item.start));
  const [start, setStart] = useState(timeOf(item.start));
  const [end, setEnd] = useState(timeOf(item.end));
  const [location, setLocation] = useState(item.location ?? "");
  const save = useSaveMutation(async () => {
    const s = joinDateTime(date, start);
    let e = joinDateTime(date, end);
    if (e <= s) e = addMinutes(e, 1440); // ends after midnight
    await moveOccurrence(item.id, item.originalDate!, s, e, location);
  }, onClose);
  useEffect(() => {
    if (!open) return;
    setDate(dateOf(item.start));
    setStart(timeOf(item.start));
    setEnd(timeOf(item.end));
    setLocation(item.location ?? "");
  }, [open, item]);
  return (
    <FormModal open={open} onClose={onClose} title="Move this occurrence" submitLabel="Move" submitting={save.isPending} formError={save.formError} onSubmit={() => save.mutate(undefined)}>
      <p className="text-sm text-muted">Only the {formatDate(item.originalDate)} occurrence changes; every other week stays the same.</p>
      <div className="grid grid-cols-[1fr_7rem_7rem] gap-3">
        <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={save.fieldErrors.start} />
        <TextField label="Start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        <TextField label="End" type="time" value={end} onChange={(e) => setEnd(e.target.value)} error={save.fieldErrors.end} />
      </div>
      <TextField label="Room / location" value={location} onChange={(e) => setLocation(e.target.value)} />
    </FormModal>
  );
}

interface Props {
  item: CalendarItem | null;
  onClose: () => void;
  conflicts: Conflict<CalendarItem>[];
  /** Everything visible around the item, for finding free slots. */
  context: CalendarItem[];
}

export function ItemDialog({ item, onClose, conflicts, context }: Props) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const [editSeries, setEditSeries] = useState<RecurringEvent | null>(null);
  const [moving, setMoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setError(null);
    setConfirmDelete(false);
  }, [item]);

  if (!item) return null;
  const meta = EVENT_TYPE_META[item.type];
  const mine = conflicts.filter((c) => c.a.key === item.key || c.b.key === item.key);
  const isSeries = item.source === "series";
  const isLinked = item.source === "assignment" || item.source === "exam" || item.source === "project" || item.source === "milestone";
  const linkedPath = item.source === "exam" ? `/studies/exams/${item.id}` : item.source === "assignment" ? `/studies/assignments/${item.id}` : `/projects/${item.id}`;
  const linkedLabel = item.source === "exam" ? "exam" : item.source === "assignment" ? "assignment" : "project";

  const run = async (label: string, fn: () => Promise<unknown>, close = true) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await client.invalidateQueries();
      if (close) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const openLecture = (mode: "page" | "start") =>
    run(
      mode,
      async () => {
        const lecture = await getOrCreateLectureForDate(item.courseId!, dateOf(item.start), timeOf(item.start));
        navigate(mode === "start" ? `/lecture/${lecture.id}` : `/studies/lectures/${lecture.id}`);
      },
      true,
    );

  /** Moves the flexible side of a conflict into a suggested free slot. */
  const applySlot = (t: CalendarItem, start: string, end: string) =>
    run("move", async () => {
      if (t.source === "event") {
        const ev = await getEvent(t.id);
        if (ev) await updateEvent(ev.id, { ...ev, start, end });
      } else {
        await moveOccurrence(t.id, t.originalDate!, start, end);
      }
    });

  const duration = diffMinutes(item.start, item.end);

  return (
    <>
      <Modal open={!editEvent && !editSeries && !moving} title={item.title} onClose={onClose}>
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex items-start gap-3">
            <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: itemColor(item) }} />
            <div className="space-y-1">
              <p className="font-medium">
                {meta.emoji} {meta.label}
                {item.courseCode && <span className="text-muted"> · {item.courseCode}</span>}
              </p>
              <p className="flex items-center gap-1.5 text-muted">
                <CalendarClock className="size-3.5" aria-hidden />
                {formatDate(dateOf(item.start), { weekday: "long", day: "numeric", month: "long" })}
                {item.allDay ? " · All day" : ` · ${timeOf(item.start)}–${timeOf(item.end)} (${formatDuration(duration)})`}
              </p>
              {isSeries && (
                <p className="flex items-center gap-1.5 text-muted">
                  <Repeat className="size-3.5" aria-hidden /> Repeats weekly{item.moved && " · this week rescheduled"}
                </p>
              )}
              {item.location && (
                <p className="flex items-center gap-1.5 text-muted">
                  <MapPin className="size-3.5" aria-hidden /> {item.location}
                </p>
              )}
              {item.lecturer && (
                <p className="flex items-center gap-1.5 text-muted">
                  <User className="size-3.5" aria-hidden /> {item.lecturer}
                </p>
              )}
              {item.notes && <p className="whitespace-pre-wrap text-muted">{item.notes}</p>}
            </div>
          </div>

          {mine.length > 0 && (
            <div className="rounded-lg border border-danger/40 bg-danger-soft p-3">
              {mine.map((c) => {
                const other = c.a.key === item.key ? c.b : c.a;
                const s = suggestAlternatives(c, context);
                return (
                  <div key={other.key} className="space-y-2">
                    <p className="flex items-center gap-1.5 font-medium text-danger">
                      <AlertTriangle className="size-4" aria-hidden /> Schedule conflict
                    </p>
                    <p className="text-fg">
                      Overlaps {EVENT_TYPE_META[other.type].label.toLowerCase()} “{other.title}” ({timeOf(other.start)}–{timeOf(other.end)}) by {formatDuration(c.overlap)}.
                    </p>
                    {s && s.slots.length > 0 ? (
                      <div>
                        <p className="mb-1 text-xs text-muted">Move “{s.item.title}” to a free slot:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {s.slots.map((slot) => (
                            <Button key={slot.start} size="sm" loading={busy === "move"} onClick={() => void applySlot(s.item, slot.start, slot.end)}>
                              {formatDate(dateOf(slot.start), { weekday: "short", day: "numeric" })} {timeOf(slot.start)}–{timeOf(slot.end)}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted">Both are fixed commitments. Consider arranging time off, or moving one of them in its own settings.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {item.type === "class" && item.courseId && !isLinked && (
            <div className="flex gap-2">
              <Button variant="primary" icon={<Play className="size-4" />} loading={busy === "start"} onClick={() => void openLecture("start")}>
                Start lecture
              </Button>
              <Button icon={<NotebookPen className="size-4" />} loading={busy === "page"} onClick={() => void openLecture("page")}>
                Lecture notes
              </Button>
            </div>
          )}

          {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-danger">{error}</p>}

          {isLinked ? (
            <div className="-mx-5 -mb-4 flex items-center gap-2 border-t border-border px-5 py-3">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onClose();
                  navigate(linkedPath);
                }}
              >
                Open {linkedLabel}
              </Button>
              <span className="text-xs text-subtle">Change the date on its page; the calendar follows.</span>
            </div>
          ) : (
          <div className="-mx-5 -mb-4 flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
            {isSeries ? (
              <>
                <Button size="sm" icon={<CalendarClock className="size-3.5" />} onClick={() => setMoving(true)}>
                  Move this one
                </Button>
                {item.moved ? (
                  <Button size="sm" icon={<RotateCcw className="size-3.5" />} loading={busy === "restore"} onClick={() => void run("restore", () => restoreOccurrence(item.id, item.originalDate!))}>
                    Restore original time
                  </Button>
                ) : (
                  <Button size="sm" icon={<XCircle className="size-3.5" />} loading={busy === "skip"} onClick={() => void run("skip", () => cancelOccurrence(item.id, item.originalDate!))}>
                    {item.type === "work" ? "Day off" : "Skip this one"}
                  </Button>
                )}
                <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => void getRecurring(item.id).then(setEditSeries)}>
                  Edit every week
                </Button>
              </>
            ) : (
              <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => void getEvent(item.id).then(setEditEvent)}>
                Edit
              </Button>
            )}
            <span className="flex-1" />
            {confirmDelete ? (
              <span className="flex items-center gap-1.5">
                {isSeries ? (
                  <>
                    <Button size="sm" variant="danger" loading={busy === "del-following"} onClick={() => void run("del-following", () => endRecurringBefore(item.id, item.originalDate!))}>
                      This and later
                    </Button>
                    <Button size="sm" variant="danger" loading={busy === "del-all"} onClick={() => void run("del-all", () => deleteRecurring(item.id))}>
                      All weeks
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="danger" loading={busy === "del"} onClick={() => void run("del", () => deleteEvent(item.id))}>
                    Confirm delete
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </div>
          )}
        </div>
      </Modal>

      {editEvent && (
        <EventForm
          open
          event={editEvent}
          onClose={() => {
            setEditEvent(null);
            onClose();
          }}
        />
      )}
      {editSeries && (
        <RecurringForm
          open
          series={editSeries}
          onClose={() => {
            setEditSeries(null);
            onClose();
          }}
        />
      )}
      {isSeries && (
        <MoveOccurrenceForm
          item={item}
          open={moving}
          onClose={() => {
            setMoving(false);
            onClose();
          }}
        />
      )}
    </>
  );
}
