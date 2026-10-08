import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Layers, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, ProgressBar } from "@/components/ui/Feedback";
import { Markdown } from "@/components/Markdown";
import { formatInterval, newState, previewIntervals, RATINGS, type Rating, type SrsState } from "@/domain/srs";
import { nowLocal } from "@/domain/time";
import { reviewFlashcard, type Flashcard } from "@/services/practice";

const LABELS: Record<Rating, { label: string; className: string; key: string }> = {
  again: { label: "Again", className: "border-danger/50 text-danger hover:bg-danger-soft", key: "1" },
  hard: { label: "Hard", className: "border-warning/50 text-warning hover:bg-warning-soft", key: "2" },
  good: { label: "Good", className: "border-success/50 text-success hover:bg-success-soft", key: "3" },
  easy: { label: "Easy", className: "border-accent/50 text-accent hover:bg-accent-soft", key: "4" },
};

interface Props {
  cards: Flashcard[];
  onDone: () => void;
}

/**
 * Review loop: show front → reveal back → rate. Cards rated "Again" come back
 * at the end of this session. Keyboard: Space to reveal, 1–4 to rate.
 */
export function ReviewSession({ cards, onDone }: Props) {
  const client = useQueryClient();
  const [queue, setQueue] = useState(cards);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = nowLocal().slice(0, 10);
  const card = queue[0];

  const state: SrsState = useMemo(() => card?.srs ?? newState(today), [card, today]);
  const preview = previewIntervals(state, today);

  const rate = useCallback(
    async (r: Rating) => {
      if (!card || busy) return;
      setBusy(true);
      setError(null);
      try {
        const next = await reviewFlashcard(card.id, r, today, nowLocal());
        setReviewed((n) => n + 1);
        setQueue((q) => {
          const rest = q.slice(1);
          // Due again today → see it again before the session ends.
          return next.intervalDays === 0 ? [...rest, { ...card, dueDate: next.dueDate, intervalDays: 0, srs: next }] : rest;
        });
        setRevealed(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [card, busy, today],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed) {
        const r = RATINGS.find((x) => LABELS[x].key === e.key);
        if (r) void rate(r);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, rate]);

  useEffect(() => {
    if (!card && reviewed > 0) void client.invalidateQueries();
  }, [card, reviewed, client]);

  if (!card) {
    return (
      <Card className="mx-auto flex max-w-lg flex-col items-center gap-3 p-8 text-center">
        <PartyPopper className="size-8 text-accent" aria-hidden />
        <p className="text-lg font-semibold">Session complete</p>
        <p className="text-sm text-muted">You reviewed {reviewed} card{reviewed === 1 ? "" : "s"}. Upcoming reviews are scheduled automatically.</p>
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-3 text-xs text-muted">
        <Layers className="size-3.5" aria-hidden />
        <span className="tabular-nums">
          {reviewed} reviewed · {queue.length} left
        </span>
        <div className="flex-1">
          <ProgressBar value={reviewed / (reviewed + queue.length)} label="Review progress" />
        </div>
        {card.topicName && <span>{card.topicName}</span>}
        {!card.dueDate && <span className="rounded bg-accent-soft px-1.5 text-accent">New</span>}
      </div>
      <Card className="min-h-72 p-8">
        <Markdown source={card.front} className="text-center text-lg" />
        {revealed && (
          <>
            <hr className="my-6 border-border" />
            <Markdown source={card.back} className="text-center" />
          </>
        )}
      </Card>
      {error && <p className="text-sm text-danger">{error}</p>}
      {!revealed ? (
        <Button variant="primary" className="mx-auto w-64" onClick={() => setRevealed(true)}>
          Show answer <kbd className="ml-2 rounded bg-black/15 px-1 text-[10px]">Space</kbd>
        </Button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {RATINGS.map((r) => (
            <button
              key={r}
              type="button"
              disabled={busy}
              onClick={() => void rate(r)}
              className={clsx("flex flex-col items-center rounded-lg border py-2.5 text-sm font-medium transition-colors disabled:opacity-60", LABELS[r].className)}
            >
              {LABELS[r].label}
              <span className="text-[11px] font-normal text-muted">
                {formatInterval(preview[r])} · key {LABELS[r].key}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
