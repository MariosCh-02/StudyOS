import { CheckCircle2, CircleDashed, Lightbulb, Shuffle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Markdown } from "@/components/Markdown";
import { correctAnswerText, whyWrongForResponse, type Response } from "@/domain/questions";
import type { Question } from "@/services/practice";

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
        <span className="flex size-4 items-center justify-center rounded-full bg-surface-2 text-[10px] text-fg">{n}</span>
        {title}
      </h4>
      <div className="text-sm">{children}</div>
    </section>
  );
}

interface Props {
  question: Question;
  response: Response;
  /** Final score 0..1, or "self" while waiting for self-assessment. */
  score: number | "self";
  onSelfAssess: (score: number) => void;
  onSimilar?: () => void;
  similarAvailable: boolean;
}

/**
 * Feedback after answering. Wrong (or partly wrong) answers get the five
 * parts from the spec: correct answer, explanation, why it was wrong, an
 * example, and a similar question to try.
 */
export function Feedback({ question: q, response, score, onSelfAssess, onSimilar, similarAvailable }: Props) {
  if (score === "self") {
    return (
      <div className="rounded-lg border border-border bg-surface-2/50 p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-medium">
          <CircleDashed className="size-4 text-accent" aria-hidden /> Compare with the model answer
        </p>
        <Markdown source={correctAnswerText(q.data)} className="text-sm" />
        {q.explanation && <Markdown source={q.explanation} className="mt-3 text-sm text-muted" />}
        <p className="mt-4 mb-2 text-sm">How did you do?</p>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={() => onSelfAssess(1)}>
            Got it right
          </Button>
          <Button size="sm" onClick={() => onSelfAssess(0.5)}>
            Partly
          </Button>
          <Button size="sm" onClick={() => onSelfAssess(0)}>
            Not yet
          </Button>
        </div>
      </div>
    );
  }

  if (score >= 1) {
    return (
      <div className="rounded-lg border border-success/40 bg-success-soft p-4">
        <p className="flex items-center gap-2 font-medium text-success">
          <CheckCircle2 className="size-5" aria-hidden /> Correct
        </p>
        {q.explanation && <Markdown source={q.explanation} className="mt-2 text-sm" />}
      </div>
    );
  }

  const optionWhy = whyWrongForResponse(q.data, response);
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-danger/40 bg-danger-soft/50 p-4">
      <p className="flex items-center gap-2 font-medium text-danger">
        <XCircle className="size-5" aria-hidden /> {score > 0 ? `Partly right (${Math.round(score * 100)}%)` : "Not quite"}
      </p>
      <Section n={1} title="Correct answer">
        <Markdown source={correctAnswerText(q.data)} />
      </Section>
      {q.explanation && (
        <Section n={2} title="Explanation">
          <Markdown source={q.explanation} />
        </Section>
      )}
      {(optionWhy.length > 0 || q.whyWrong) && (
        <Section n={3} title="Why that's wrong">
          {optionWhy.map((w) => (
            <Markdown key={w} source={w} />
          ))}
          {q.whyWrong && <Markdown source={q.whyWrong} />}
        </Section>
      )}
      {q.example && (
        <Section n={4} title="Example">
          <Markdown source={q.example} />
        </Section>
      )}
      <Section n={5} title="Try a similar question">
        {similarAvailable && onSimilar ? (
          <Button size="sm" icon={<Shuffle className="size-3.5" />} onClick={onSimilar}>
            Give me a similar question next
          </Button>
        ) : (
          <p className="flex items-center gap-1.5 text-muted">
            <Lightbulb className="size-3.5" aria-hidden /> No other question on {q.topicName ?? "this topic"} yet. It's scheduled for review so you'll see it again soon.
          </p>
        )}
      </Section>
    </div>
  );
}
