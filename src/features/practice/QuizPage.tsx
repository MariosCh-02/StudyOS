import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { Brain, Play } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Card, EmptyState, ErrorState, Spinner } from "@/components/ui/Feedback";
import { SelectField } from "@/components/ui/Field";
import { toDateKey } from "@/domain/dates";
import { getDiagnostic } from "@/services/learning";
import { dueQuestionIds, listQuestions, type Question, type QuizKind } from "@/services/practice";
import { QuizRunner, type QuizConfig } from "./QuizRunner";

/**
 * /practice/quiz?track=|subject=|lesson=|course=|topic=|due=1|diagnostic=&title=&count=&kind=
 * Loads the question pool, lets the learner choose length and mode, then runs the quiz.
 */
/** Keyed by the query string, so opening another quiz link resets everything. */
export default function QuizPage() {
  const { search } = useLocation();
  return <QuizPageInner key={search} />;
}

function QuizPageInner() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [pool, setPool] = useState<Question[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [config, setConfig] = useState<QuizConfig | null>(null);
  const [run, setRun] = useState(0);
  const diagnosticId = params.get("diagnostic");
  const kind = (diagnosticId ? "diagnostic" : (params.get("kind") as QuizKind | null)) ?? "practice";
  const [title, setTitle] = useState(params.get("title") ?? "Practice");
  const [count, setCount] = useState(params.get("count") ?? "10");
  const [mode, setMode] = useState(kind === "lesson" ? "order" : "adaptive");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        let qs: Question[];
        if (diagnosticId) {
          const d = await getDiagnostic(diagnosticId);
          if (!d) throw new Error("Diagnostic not found.");
          setTitle(d.title);
          qs = await listQuestions({ ids: d.questionIds });
        } else if (params.get("due")) {
          qs = await listQuestions({ ids: await dueQuestionIds(toDateKey(new Date())) });
        } else {
          qs = await listQuestions({
            trackId: params.get("track") ?? undefined,
            subjectId: params.get("subject") ?? undefined,
            lessonId: params.get("lesson") ?? undefined,
            courseId: params.get("course") ?? undefined,
            topicId: params.get("topic") ?? undefined,
          });
        }
        if (alive) setPool(qs);
      } catch (err) {
        if (alive) setError(err);
      }
    })();
    return () => {
      alive = false;
    };
  }, [params, diagnosticId]);

  if (error) return <ErrorState error={error} />;
  if (!pool) return <Spinner label="Loading questions…" />;

  const start = (questions: Question[] = pool) => {
    const n = count === "all" ? questions.length : Number(count);
    setConfig({
      kind,
      title,
      pool: questions,
      count: diagnosticId ? questions.length : n,
      adaptive: !diagnosticId && mode === "adaptive",
      showFeedback: !diagnosticId,
      meta: { diagnosticId, source: Object.fromEntries(params) },
    });
    setRun((r) => r + 1);
  };

  return (
    <>
      <PageHeader title={title} subtitle={diagnosticId ? "Diagnostic: answer every question; results and a study plan follow at the end." : `${pool.length} question${pool.length === 1 ? "" : "s"} available`} />
      {pool.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Brain className="size-5" />}
            title={params.get("due") ? "Nothing due for review" : "No questions here yet"}
            description={params.get("due") ? "Questions you answer come back on a spaced schedule. Check again tomorrow." : "Add questions in Practice → Questions, or install a content pack."}
            action={<Button onClick={() => navigate("/practice")}>Back to Practice</Button>}
          />
        </Card>
      ) : config ? (
        <div className="mx-auto max-w-3xl">
          <QuizRunner
            key={run}
            config={config}
            onExit={() => navigate(-1)}
            onFinished={(sessionId) => {
              if (diagnosticId) navigate(`/practice/diagnostics/results/${sessionId}`, { replace: true });
            }}
            onPracticeMistakes={(missed) => start(missed)}
          />
        </div>
      ) : (
        <Card className="mx-auto max-w-lg p-6">
          {!diagnosticId && (
            <div className="grid grid-cols-2 gap-3">
              <SelectField
                label="Questions"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                options={[...["5", "10", "20", "30"].filter((n) => Number(n) <= pool.length), "all"].map((n) => ({ value: n, label: n === "all" ? `All (${pool.length})` : n }))}
              />
              <SelectField
                label="Mode"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                options={[
                  { value: "adaptive", label: "Adaptive difficulty" },
                  { value: "order", label: "In order" },
                ]}
                hint={mode === "adaptive" ? "Harder after right answers, easier after wrong ones; weak topics first." : undefined}
              />
            </div>
          )}
          {diagnosticId && <p className="text-sm text-muted">{pool.length} questions. There's no feedback during the test, so you see your real level. It usually takes about {Math.round(pool.length * 1.2)} minutes.</p>}
          <Button variant="primary" icon={<Play className="size-4" />} className="mt-5 w-full" onClick={() => start()}>
            Start
          </Button>
        </Card>
      )}
    </>
  );
}
