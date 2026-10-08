import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Award, HelpCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, ProgressBar } from "@/components/ui/Feedback";
import { Markdown } from "@/components/Markdown";
import { grade, QUESTION_TYPE_LABELS, type Response } from "@/domain/questions";
import { pickNext, similarQuestion, startAdaptive, updateLevel, type AdaptiveState } from "@/domain/mastery";
import { nowLocal } from "@/domain/time";
import { finishQuizSession, recordAttempt, startQuizSession, topicMastery, type Question, type QuizKind } from "@/services/practice";
import { Feedback } from "./Feedback";
import { emptyResponse, isAnswered, QuestionView } from "./QuestionView";

export interface QuizConfig {
  kind: QuizKind;
  title: string;
  pool: Question[];
  count: number;
  adaptive: boolean;
  /** Diagnostics hide feedback until the end. */
  showFeedback: boolean;
  meta?: Record<string, unknown>;
}

interface Answer {
  question: Question;
  score: number;
}

interface Props {
  config: QuizConfig;
  onFinished: (sessionId: string, answers: Answer[]) => void;
  onPracticeMistakes?: (questions: Question[]) => void;
  onExit: () => void;
}

export function QuizRunner({ config, onFinished, onPracticeMistakes, onExit }: Props) {
  const client = useQueryClient();
  const sessionId = useRef<string | null>(null);
  const [adaptive, setAdaptive] = useState<AdaptiveState>(() => startAdaptive(3));
  const [masteryMap, setMasteryMap] = useState<Map<string, number | null>>(new Map());
  const [current, setCurrent] = useState<Question | null>(null);
  const [response, setResponse] = useState<Response | null>(null);
  const [score, setScore] = useState<number | "self" | null>(null);
  const [hint, setHint] = useState(false);
  const [answers, setAnswersState] = useState<Answer[]>([]);
  // Mirror of answers for callbacks that run before React re-renders.
  const answersRef = useRef<Answer[]>([]);
  const setAnswers = (list: Answer[]) => {
    answersRef.current = list;
    setAnswersState(list);
  };
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(Date.now());
  const total = Math.min(config.count, config.pool.length);
  const poolItems = useMemo(() => config.pool.map((q) => ({ id: q.id, difficulty: q.difficulty, topicId: q.topicId })), [config.pool]);

  const choose = (state: AdaptiveState, forced: Question | null): Question | null => {
    if (forced) return forced;
    if (!config.adaptive) return config.pool.find((q) => !state.asked.has(q.id)) ?? null;
    const item = pickNext(poolItems, state, masteryMap);
    return item ? (config.pool.find((q) => q.id === item.id) ?? null) : null;
  };

  const show = (q: Question | null) => {
    setCurrent(q);
    setResponse(q ? emptyResponse(q) : null);
    setScore(null);
    setHint(false);
    shownAt.current = Date.now();
  };

  // Start the session and pick the first question.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        sessionId.current = await startQuizSession(config.kind, config.title, { count: config.count, adaptive: config.adaptive, ...config.meta }, nowLocal());
        const m = new Map((await topicMastery(nowLocal().slice(0, 10))).map((t) => [t.topicId, t.mastery]));
        if (!alive) return;
        setMasteryMap(m);
        const first = config.adaptive
          ? config.pool.find((q) => q.id === pickNext(poolItems, adaptive, m)?.id) ?? null
          : (config.pool[0] ?? null);
        show(first);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
    // Runs once per quiz.
  }, []);

  const save = async (q: Question, s: number, r: Response) => {
    // Count the answer immediately; the database write follows.
    setAnswers([...answersRef.current, { question: q, score: s }]);
    setAdaptive((st) => ({ ...updateLevel(st, s), asked: new Set([...st.asked, q.id]) }));
    try {
      await recordAttempt(q.id, sessionId.current, s, r, Date.now() - shownAt.current, nowLocal());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submit = async () => {
    if (!current || !response) return;
    const result = grade(current.data, response);
    if (result.status === "self") {
      setScore("self");
      return;
    }
    setScore(result.score);
    await save(current, result.score, response);
    if (!config.showFeedback) next(result.score);
  };

  const selfAssess = async (s: number) => {
    if (!current || !response) return;
    setScore(s);
    await save(current, s, response);
    if (!config.showFeedback) next(s);
  };

  const finish = async () => {
    setDone(true);
    if (sessionId.current) {
      await finishQuizSession(sessionId.current, nowLocal()).catch(() => undefined);
      await client.invalidateQueries();
      onFinished(sessionId.current, answersRef.current);
    }
  };

  /**
   * Moves on. `lastScore` is passed when called straight after answering
   * (adaptive state hasn't re-rendered yet); `forced` is a chosen next question.
   */
  const next = (lastScore?: number, forced: Question | null = null) => {
    if (answersRef.current.length >= total && !forced) {
      void finish();
      return;
    }
    const asked = new Set(adaptive.asked);
    if (current) asked.add(current.id);
    const level = lastScore != null && !adaptive.asked.has(current?.id ?? "") ? updateLevel(adaptive, lastScore).level : adaptive.level;
    const q = choose({ level, asked }, forced);
    if (!q) void finish();
    else show(q);
  };

  const similar = current ? similarQuestion(poolItems, { id: current.id, difficulty: current.difficulty, topicId: current.topicId }, new Set([...adaptive.asked, current.id])) : null;

  if (error) return <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>;

  if (done) {
    const pct = answers.length ? (answers.reduce((s, a) => s + a.score, 0) / answers.length) * 100 : 0;
    const missed = answers.filter((a) => a.score < 1).map((a) => a.question);
    const byTopic = new Map<string, { n: number; s: number }>();
    for (const a of answers) {
      const k = a.question.topicName ?? "Other";
      const g = byTopic.get(k) ?? { n: 0, s: 0 };
      byTopic.set(k, { n: g.n + 1, s: g.s + a.score });
    }
    return (
      <Card className="p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Award className="size-8 text-accent" aria-hidden />
          <p className="text-3xl font-semibold tabular-nums">{Math.round(pct)}%</p>
          <p className="text-sm text-muted">
            {answers.length} question{answers.length === 1 ? "" : "s"} · {config.title}
          </p>
        </div>
        {byTopic.size > 0 && (
          <ul className="mx-auto mt-5 max-w-md space-y-2 text-sm">
            {[...byTopic].map(([topic, g]) => (
              <li key={topic}>
                <div className="mb-0.5 flex justify-between">
                  <span>{topic}</span>
                  <span className="text-muted tabular-nums">{Math.round((g.s / g.n) * 100)}%</span>
                </div>
                <ProgressBar value={g.s / g.n} label={`${topic} score`} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-5 text-center text-xs text-subtle">Mastery and review schedules have been updated. Missed questions come back for review today.</p>
        <div className="mt-4 flex justify-center gap-2">
          {missed.length > 0 && onPracticeMistakes && (
            <Button icon={<RotateCcw className="size-4" />} onClick={() => onPracticeMistakes(missed)}>
              Practise {missed.length} mistake{missed.length === 1 ? "" : "s"}
            </Button>
          )}
          <Button variant="primary" onClick={onExit}>
            Done
          </Button>
        </div>
      </Card>
    );
  }

  if (!current || !response) return <Card className="p-6 text-center text-sm text-muted">Preparing questions…</Card>;

  const locked = score != null;
  const position = answers.length + (score != null && score !== "self" ? 0 : 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="tabular-nums">
          Question {Math.min(position, total)} of {total}
        </span>
        <div className="flex-1">
          <ProgressBar value={answers.length / total} label="Quiz progress" />
        </div>
        <span>{QUESTION_TYPE_LABELS[current.type]}</span>
        <span className={clsx("rounded px-1.5 py-0.5", current.difficulty >= 4 ? "bg-danger-soft text-danger" : current.difficulty <= 2 ? "bg-success-soft text-success" : "bg-surface-2")}>
          Level {current.difficulty}
        </span>
        {current.topicName && <span className="truncate">{current.topicName}</span>}
      </div>

      <Card className="p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (score == null && isAnswered(response)) void submit();
            else if (score != null && score !== "self") next();
          }}
          className="flex flex-col gap-5"
        >
          <QuestionView question={current} response={response} onChange={setResponse} locked={locked} />

          {hint && current.hint && (
            <div className="rounded-md bg-accent-soft/60 px-3 py-2 text-sm">
              <Markdown source={current.hint} />
            </div>
          )}

          {score != null && config.showFeedback && (
            <Feedback
              question={current}
              response={response}
              score={score}
              onSelfAssess={(s) => void selfAssess(s)}
              similarAvailable={!!similar}
              onSimilar={() => {
                const q = similar ? (config.pool.find((x) => x.id === similar.id) ?? null) : null;
                if (q) next(undefined, q);
              }}
            />
          )}
          {score === "self" && !config.showFeedback && (
            <Feedback question={current} response={response} score="self" onSelfAssess={(s) => void selfAssess(s)} similarAvailable={false} />
          )}

          <div className="flex items-center gap-2">
            {score == null ? (
              <>
                <Button type="submit" variant="primary" disabled={!isAnswered(response)}>
                  {current.type === "coding" || current.type === "explain" ? "Show model answer" : "Check answer"}
                </Button>
                {current.hint && !hint && (
                  <Button variant="ghost" icon={<HelpCircle className="size-4" />} onClick={() => setHint(true)}>
                    Hint
                  </Button>
                )}
              </>
            ) : score !== "self" ? (
              <Button type="submit" variant="primary" autoFocus>
                {answers.length >= total ? "See results" : "Next question"}
              </Button>
            ) : null}
            <span className="flex-1" />
            <Button variant="ghost" onClick={() => (answers.length ? void finish() : onExit())}>
              {answers.length ? "Finish now" : "Cancel"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
