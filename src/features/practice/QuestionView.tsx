import { useMemo } from "react";
import clsx from "clsx";
import { Check, X } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import type { Choice, Response } from "@/domain/questions";
import type { Question } from "@/services/practice";

/** Deterministic shuffle so options don't jump around between renders. */
function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function emptyResponse(q: Question): Response {
  switch (q.type) {
    case "mcq":
      return { type: "mcq", selected: [] };
    case "numeric":
      return { type: "numeric", value: "" };
    case "short":
    case "explain":
    case "predict":
      return { type: q.type, text: "" };
    case "matching":
      return { type: "matching", matches: {} };
    case "coding":
      return { type: "coding", code: q.data.type === "coding" ? (q.data.starter ?? "") : "" };
    case "debugging":
      return { type: "debugging", selected: [], text: "" };
  }
}

export function isAnswered(r: Response): boolean {
  switch (r.type) {
    case "mcq":
      return r.selected.length > 0;
    case "numeric":
      return r.value.trim() !== "";
    case "matching":
      return Object.keys(r.matches).length > 0;
    case "coding":
      return r.code.trim() !== "";
    case "debugging":
      return (r.selected?.length ?? 0) > 0 || !!r.text?.trim();
    default:
      return r.text.trim() !== "";
  }
}

const textArea = "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-80";

function Choices({ choices, multiple, selected, onChange, locked, seed }: { choices: Choice[]; multiple: boolean; selected: string[]; onChange: (s: string[]) => void; locked: boolean; seed: string }) {
  const order = useMemo(() => seededShuffle(choices, seed), [choices, seed]);
  return (
    <div role={multiple ? "group" : "radiogroup"} className="flex flex-col gap-2">
      {multiple && <p className="text-xs text-subtle">Select all that apply.</p>}
      {order.map((c) => {
        const on = selected.includes(c.id);
        const state = locked ? (c.correct ? "correct" : on ? "wrong" : "idle") : on ? "on" : "idle";
        return (
          <button
            key={c.id}
            type="button"
            role={multiple ? "checkbox" : "radio"}
            aria-checked={on}
            disabled={locked}
            onClick={() => onChange(multiple ? (on ? selected.filter((x) => x !== c.id) : [...selected, c.id]) : [c.id])}
            className={clsx(
              "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
              state === "on" && "border-accent bg-accent-soft",
              state === "idle" && "border-border hover:border-accent/50",
              state === "correct" && "border-success bg-success-soft",
              state === "wrong" && "border-danger bg-danger-soft",
            )}
          >
            <span className={clsx("mt-0.5 flex size-4 shrink-0 items-center justify-center border", multiple ? "rounded" : "rounded-full", on ? "border-accent bg-accent text-accent-fg" : "border-border")}>
              {on && <Check className="size-3" />}
            </span>
            <Markdown source={c.text} className="min-w-0 flex-1" />
            {locked && c.correct && <Check className="size-4 shrink-0 text-success" aria-label="Correct answer" />}
            {locked && on && !c.correct && <X className="size-4 shrink-0 text-danger" aria-label="Your answer" />}
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  question: Question;
  response: Response;
  onChange: (r: Response) => void;
  locked: boolean;
}

export function QuestionView({ question: q, response, onChange, locked }: Props) {
  const d = q.data;
  const rightOptions = useMemo(() => (d.type === "matching" ? seededShuffle(d.pairs.map((p, i) => ({ text: p.right, index: i })), q.id) : []), [d, q.id]);

  return (
    <div className="flex flex-col gap-4">
      <Markdown source={q.prompt} className="text-[15px]" />

      {d.type === "mcq" && response.type === "mcq" && (
        <Choices choices={d.choices} multiple={!!d.multiple} selected={response.selected} onChange={(selected) => onChange({ type: "mcq", selected })} locked={locked} seed={q.id} />
      )}

      {d.type === "numeric" && response.type === "numeric" && (
        <label className="flex items-center gap-2">
          <span className="sr-only">Your answer</span>
          <input
            autoFocus
            inputMode="decimal"
            value={response.value}
            disabled={locked}
            onChange={(e) => onChange({ type: "numeric", value: e.target.value })}
            placeholder="Your answer"
            className="h-10 w-48 rounded-md border border-border bg-surface px-3 text-sm tabular-nums focus:border-accent focus:outline-none"
          />
          {d.unit && <span className="text-sm text-muted">{d.unit}</span>}
          <span className="text-xs text-subtle">Decimals, fractions (3/4) and 1e-3 are accepted.</span>
        </label>
      )}

      {(d.type === "short" || d.type === "explain") && (response.type === "short" || response.type === "explain") && (
        <textarea
          autoFocus
          rows={d.type === "explain" ? 6 : 2}
          value={response.text}
          disabled={locked}
          onChange={(e) => onChange({ type: d.type, text: e.target.value })}
          placeholder={d.type === "explain" ? "Explain in your own words…" : "Your answer"}
          className={textArea}
        />
      )}

      {d.type === "predict" && response.type === "predict" && (
        <>
          <Markdown source={"```" + d.language + "\n" + d.code + "\n```"} />
          <label className="text-[13px] font-medium text-muted" htmlFor={`predict-${q.id}`}>
            What does it print?
          </label>
          <textarea id={`predict-${q.id}`} rows={3} value={response.text} disabled={locked} onChange={(e) => onChange({ type: "predict", text: e.target.value })} className={clsx(textArea, "font-mono")} />
        </>
      )}

      {d.type === "matching" && response.type === "matching" && (
        <div className="flex flex-col gap-2">
          {d.pairs.map((p, i) => {
            const chosen = response.matches[i];
            const ok = locked && chosen === i;
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr] items-center gap-3">
                <Markdown source={p.left} className="text-sm" />
                <select
                  aria-label={`Match for ${p.left}`}
                  value={chosen ?? ""}
                  disabled={locked}
                  onChange={(e) => onChange({ type: "matching", matches: { ...response.matches, [i]: Number(e.target.value) } })}
                  className={clsx("h-9 rounded-md border bg-surface px-2 text-sm focus:outline-none", locked ? (ok ? "border-success" : "border-danger") : "border-border focus:border-accent")}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {rightOptions.map((r) => (
                    <option key={r.index} value={r.index}>
                      {r.text}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}

      {d.type === "coding" && response.type === "coding" && (
        <>
          <p className="text-xs text-subtle">Write your solution here or in your editor, then compare it with the reference solution. StudyOS doesn't run code.</p>
          <textarea rows={10} spellCheck={false} value={response.code} disabled={locked} onChange={(e) => onChange({ type: "coding", code: e.target.value })} className={clsx(textArea, "font-mono text-[13px]")} />
        </>
      )}

      {d.type === "debugging" && response.type === "debugging" && (
        <>
          <Markdown source={"```" + d.language + "\n" + d.code + "\n```"} />
          {d.choices?.length ? (
            <Choices choices={d.choices} multiple={false} selected={response.selected ?? []} onChange={(selected) => onChange({ ...response, selected })} locked={locked} seed={q.id} />
          ) : (
            <textarea rows={4} value={response.text ?? ""} disabled={locked} onChange={(e) => onChange({ ...response, text: e.target.value })} placeholder="What's the bug, and how would you fix it?" className={textArea} />
          )}
        </>
      )}
    </div>
  );
}
