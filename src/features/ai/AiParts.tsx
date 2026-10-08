import { useRef, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Markdown } from "@/components/Markdown";
import { useSettings } from "@/hooks/queries";
import { isTauri } from "@/lib/native";
import { markdownToNodes } from "@/domain/noteMarkdown";
import type { DocNode } from "@/domain/noteContent";
import { QUESTION_TYPE_LABELS } from "@/domain/questions";
import type { CardDraft, QuestionDraft } from "@/domain/aiPrompts";

/** True when an AI provider and model are set up (desktop app only). */
export function useAiEnabled(): boolean {
  const settings = useSettings();
  return isTauri() && !!settings.data && settings.data.aiProvider !== "none" && !!settings.data.aiModel.trim();
}

export function AiBadge({ label }: { label: string }) {
  return (
    <p className="flex items-start gap-1.5 rounded-md bg-accent-soft px-2.5 py-1.5 text-xs text-accent">
      <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{label}</span>
    </p>
  );
}

export function TruncatedWarning() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-warning">
      <AlertTriangle className="size-3.5" aria-hidden /> The answer hit the length limit and may be cut off. Try a smaller selection.
    </p>
  );
}

/** Editor nodes for an AI answer, preceded by its AI-generated label. */
export function labelledNodes(label: string, markdown: string): DocNode[] {
  return [{ type: "paragraph", content: [{ type: "text", text: `✨ ${label}`, marks: [{ type: "italic" }] }] }, ...markdownToNodes(markdown)];
}

export type AiState<T> = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "done"; value: T };

/** Runs an AI call and tracks its state; `start` can be called again to regenerate. */
export function useAiRun<T>() {
  const [state, setState] = useState<AiState<T>>({ status: "idle" });
  // Each start (or reset) supersedes earlier requests; their late results are ignored.
  const current = useRef(0);
  const start = async (fn: () => Promise<T>) => {
    const id = ++current.current;
    setState({ status: "loading" });
    try {
      const value = await fn();
      if (id === current.current) setState({ status: "done", value });
    } catch (err) {
      if (id === current.current) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };
  const reset = () => {
    current.current++;
    setState({ status: "idle" });
  };
  return { state, start, reset };
}

export function AiLoading({ what = "Thinking" }: { what?: string }) {
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-muted">
      <Sparkles className="size-4 animate-pulse text-accent" aria-hidden /> {what}… this can take a little while.
    </p>
  );
}

export function AiError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
      <p>{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Lets the learner edit and pick AI flashcards before saving them. */
export function CardsReview({ cards, onChange }: { cards: (CardDraft & { keep: boolean })[]; onChange: (c: (CardDraft & { keep: boolean })[]) => void }) {
  const set = (i: number, patch: Partial<CardDraft & { keep: boolean }>) => onChange(cards.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const field = "w-full resize-y rounded-md border border-border bg-surface px-2 py-1 text-sm focus:border-accent focus:outline-none";
  return (
    <ul className="flex max-h-[26rem] flex-col gap-2 overflow-y-auto">
      {cards.map((c, i) => (
        <li key={i} className={clsx("flex gap-2 rounded-md border border-border p-2", !c.keep && "opacity-50")}>
          <input type="checkbox" aria-label={`Keep card ${i + 1}`} checked={c.keep} onChange={(e) => set(i, { keep: e.target.checked })} className="mt-1.5 size-4 accent-[var(--accent)]" />
          <div className="grid flex-1 grid-cols-2 gap-2">
            <textarea aria-label={`Front of card ${i + 1}`} rows={2} value={c.front} onChange={(e) => set(i, { front: e.target.value })} className={field} />
            <textarea aria-label={`Back of card ${i + 1}`} rows={2} value={c.back} onChange={(e) => set(i, { back: e.target.value })} className={field} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const answerOf = (q: QuestionDraft): string => {
  switch (q.data.type) {
    case "mcq":
      return q.data.choices.map((c) => `${c.correct ? "✔" : "·"} ${c.text}`).join("\n");
    case "short":
      return `Answer: ${q.data.accepted.join(" / ")}`;
    case "numeric":
      return `Answer: ${q.data.answer}${q.data.tolerance != null ? ` (± ${q.data.tolerance})` : ""}`;
    case "explain":
      return `Model answer: ${q.data.modelAnswer}`;
    default:
      return "";
  }
};

/** Lets the learner pick AI questions before adding them to the bank. */
export function QuestionsReview({ questions, keep, onToggle }: { questions: QuestionDraft[]; keep: boolean[]; onToggle: (i: number) => void }) {
  return (
    <ul className="flex max-h-[26rem] flex-col gap-2 overflow-y-auto">
      {questions.map((q, i) => (
        <li key={i} className={clsx("flex gap-2 rounded-md border border-border p-3", !keep[i] && "opacity-50")}>
          <input type="checkbox" aria-label={`Keep question ${i + 1}`} checked={keep[i]} onChange={() => onToggle(i)} className="mt-1 size-4 accent-[var(--accent)]" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="mb-1 text-[11px] text-subtle">
              {QUESTION_TYPE_LABELS[q.type]} · difficulty {q.difficulty}
            </p>
            <Markdown source={q.prompt} />
            <pre className="mt-1 font-sans text-xs whitespace-pre-wrap text-muted">{answerOf(q)}</pre>
          </div>
        </li>
      ))}
    </ul>
  );
}
