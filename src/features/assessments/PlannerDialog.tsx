import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SelectField, TextField } from "@/components/ui/Field";
import { planRevision, sessionsByDay, type PlannedSession, type PlanTopic } from "@/domain/planner";
import { addDays, dateOf, nowLocal, timeOf } from "@/domain/time";
import { formatDate } from "@/domain/dates";
import type { Lecture } from "@/domain/types";
import type { Exam } from "@/services/assessments";
import { createEvent, getCalendarItems } from "@/services/calendar";

/** Revision weight from what's still open: unrevised topics and lectures needing review weigh most. */
export function revisionTopics(exam: Exam, lectures: Lecture[]): PlanTopic[] {
  const topics: PlanTopic[] = exam.topics.filter((t) => !t.done).map((t) => ({ name: t.text, weight: 2 }));
  const weights = { not_reviewed: 3, needs_review: 3, reviewed: 1, mastered: 0 } as const;
  for (const l of lectures) {
    const w = weights[l.revisionStatus];
    if (w > 0) topics.push({ name: l.number != null ? `Lecture ${l.number}: ${l.title}` : l.title, weight: w });
  }
  return topics;
}

interface Props {
  open: boolean;
  onClose: () => void;
  exam: Exam;
  lectures: Lecture[];
}

export function PlannerDialog({ open, onClose, exam, lectures }: Props) {
  const client = useQueryClient();
  const [sessionMinutes, setSessionMinutes] = useState("60");
  const [perDay, setPerDay] = useState("2");
  const [dayStart, setDayStart] = useState("09:00");
  const [dayEnd, setDayEnd] = useState("21:00");
  const [plan, setPlan] = useState<PlannedSession[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const topics = useMemo(() => revisionTopics(exam, lectures), [exam, lectures]);
  const examDate = exam.startAt ? dateOf(exam.startAt) : null;
  const from = addDays(dateOf(nowLocal()), 1);

  useEffect(() => {
    if (open) {
      setPlan(null);
      setDone(null);
      setError(null);
    }
  }, [open]);

  const generate = async () => {
    if (!examDate) return;
    setBusy(true);
    setError(null);
    try {
      const busyItems = await getCalendarItems(from, examDate);
      const p = planRevision({
        topics,
        from,
        examDate,
        busy: busyItems,
        sessionMinutes: Number(sessionMinutes),
        maxSessionsPerDay: Number(perDay),
        dayStart,
        dayEnd,
      });
      setPlan(p);
      setSelected(new Set(p.map((s) => s.start)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = plan.filter((s) => selected.has(s.start));
      for (const s of chosen) {
        await createEvent({ type: "study", title: `Revise: ${s.topic}`, start: s.start, end: s.end, allDay: false, courseId: exam.courseId, location: null, notes: `Revision for ${exam.title}` });
      }
      await client.invalidateQueries();
      setDone(chosen.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const grouped = plan ? [...sessionsByDay(plan)] : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      title="Plan revision"
      footer={
        done != null ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {plan && plan.length > 0 ? (
              <Button variant="primary" loading={busy} disabled={selected.size === 0} onClick={() => void accept()}>
                Add {selected.size} session{selected.size === 1 ? "" : "s"} to calendar
              </Button>
            ) : (
              <Button variant="primary" icon={<Sparkles className="size-4" />} loading={busy} disabled={!examDate || topics.length === 0} onClick={() => void generate()}>
                Suggest a plan
              </Button>
            )}
          </>
        )
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {done != null ? (
          <p className="py-6 text-center">
            Added {done} revision session{done === 1 ? "" : "s"} to your calendar. You can move or delete any of them there.
          </p>
        ) : !examDate ? (
          <p className="text-muted">Set the exam date first.</p>
        ) : topics.length === 0 ? (
          <p className="text-muted">Nothing left to revise: every topic is ticked and every lecture is mastered. Add topics or mark lectures as “Needs review” to plan.</p>
        ) : (
          <>
            <p className="text-muted">
              Sessions go into free time between tomorrow and {formatDate(examDate, { weekday: "long", day: "numeric", month: "long" })}, around your classes, work and
              other events. Unrevised topics and lectures marked “Not reviewed” or “Needs review” get more time; the last day starts with a full review.
            </p>
            <div className="grid grid-cols-4 gap-3">
              <SelectField label="Session length" value={sessionMinutes} onChange={(e) => setSessionMinutes(e.target.value)} options={["30", "45", "60", "90"].map((m) => ({ value: m, label: `${m} min` }))} />
              <SelectField label="Max per day" value={perDay} onChange={(e) => setPerDay(e.target.value)} options={["1", "2", "3", "4"].map((n) => ({ value: n, label: n }))} />
              <TextField label="Not before" type="time" value={dayStart} onChange={(e) => setDayStart(e.target.value)} />
              <TextField label="Not after" type="time" value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} />
            </div>
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">{topics.length} topics to cover</summary>
              <ul className="mt-1 list-disc pl-5">
                {topics.map((t) => (
                  <li key={t.name}>
                    {t.name} {t.weight >= 3 ? "(needs review)" : t.weight === 1 ? "(light review)" : ""}
                  </li>
                ))}
              </ul>
            </details>
            {plan && plan.length === 0 && <p className="rounded-md bg-warning-soft px-3 py-2 text-warning">No free time found in that window. Try shorter sessions or a wider time range.</p>}
            {plan && plan.length > 0 && (
              <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
                {grouped.map(([day, sessions]) => (
                  <div key={day} className="border-b border-border last:border-0">
                    <p className="bg-surface-2 px-3 py-1 text-xs font-medium text-muted">{formatDate(day, { weekday: "long", day: "numeric", month: "short" })}</p>
                    {sessions.map((s) => (
                      <label key={s.start} className="flex cursor-pointer items-center gap-3 px-3 py-1.5 hover:bg-surface-2">
                        <input
                          type="checkbox"
                          checked={selected.has(s.start)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(s.start);
                            else next.delete(s.start);
                            setSelected(next);
                          }}
                          className="size-4 accent-[var(--accent)]"
                        />
                        <span className="w-24 text-xs text-muted tabular-nums">
                          {timeOf(s.start)}–{timeOf(s.end)}
                        </span>
                        <span className="truncate">{s.topic}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
