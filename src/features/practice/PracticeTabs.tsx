import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ShowMore, usePaged } from "@/components/ShowMore";
import clsx from "clsx";
import { Brain, ClipboardCheck, History, Pencil, Play, Plus, Search, Target, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge, Card, EmptyState, ProgressBar, Spinner } from "@/components/ui/Feedback";
import { ConfirmDialog, FormModal } from "@/components/ui/Modal";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Markdown } from "@/components/Markdown";
import { useDiagnostics, useQuestions, useQuizSessions, useSaveMutation, useSubjects, useTopicMastery, useTracks } from "@/hooks/queries";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { masteryBand } from "@/domain/mastery";
import { QUESTION_TYPE_LABELS, QUESTION_TYPES, type QuestionType } from "@/domain/questions";
import { dateOf, timeOf } from "@/domain/time";
import { formatDate } from "@/domain/dates";
import { deleteDiagnostic, saveDiagnostic, type Diagnostic } from "@/services/learning";
import { deleteQuestion, type Question } from "@/services/practice";
import { QuestionForm } from "./QuestionForm";

// ---------------------------------------------------------------- questions

export function QuestionsTab() {
  const navigate = useNavigate();
  const subjects = useSubjects();
  const [search, setSearch] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [type, setType] = useState("");
  const questions = useQuestions({ search: search || undefined, subjectId: subjectId || undefined, type: (type || undefined) as QuestionType | undefined });
  const [editing, setEditing] = useState<Question | null>(null);
  const [creating, setCreating] = useState(false);
  const remove = useConfirmAction((q: Question) => deleteQuestion(q.id));
  const list = questions.data ?? [];
  const page = usePaged(300, search + "|" + subjectId + "|" + type);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search questions</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions or topics…" className="h-9 w-full rounded-md border border-border bg-surface pr-3 pl-9 text-sm focus:border-accent focus:outline-none" />
        </label>
        <select aria-label="Subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none">
          <option value="">All subjects</option>
          {(subjects.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none">
          <option value="">All types</option>
          {QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {QUESTION_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          New
        </Button>
        <Button variant="primary" icon={<Play className="size-4" />} disabled={!list.length} onClick={() => navigate(`/practice/quiz?${subjectId ? `subject=${subjectId}&` : ""}title=Practice`)}>
          Quiz
        </Button>
      </div>
      <Card>
        {questions.isPending ? (
          <Spinner />
        ) : list.length === 0 ? (
          <EmptyState icon={<Brain className="size-5" />} title="No questions" description="Write questions of eight types: multiple choice, numerical, coding, debugging, short answer, explain, predict output and matching." />
        ) : (
          <ul className="divide-y divide-border">
            {list.slice(0, page.limit).map((q) => (
              <li key={q.id} className="group flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Markdown source={q.prompt.length > 220 ? `${q.prompt.slice(0, 220)}…` : q.prompt} className="text-sm" />
                  <p className="mt-1 text-xs text-subtle">
                    {QUESTION_TYPE_LABELS[q.type]} · level {q.difficulty}
                    {q.topicName && ` · ${q.topicName}`}
                    {q.packId && " · from pack"}
                  </p>
                </div>
                <div className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton label="Edit question" onClick={() => setEditing(q)}>
                    <Pencil className="size-3.5" />
                  </IconButton>
                  <IconButton label="Delete question" onClick={() => remove.ask(q)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
        {list.length > page.limit && <ShowMore shown={page.limit} total={list.length} onMore={page.more} />}
      </Card>
      <QuestionForm open={creating} onClose={() => setCreating(false)} />
      <QuestionForm open={editing != null} question={editing ?? undefined} onClose={() => setEditing(null)} />
      <ConfirmDialog open={remove.target != null} title="Delete question?" busy={remove.busy} error={remove.error} onClose={remove.cancel} onConfirm={remove.confirm} message={<p>The question will be removed. Past attempts still count towards mastery.</p>} />
    </div>
  );
}

// -------------------------------------------------------------- diagnostics

function DiagnosticForm({ open, onClose, diagnostic }: { open: boolean; onClose: () => void; diagnostic?: Diagnostic }) {
  const tracks = useTracks();
  const questions = useQuestions();
  const subjects = useSubjects();
  const [title, setTitle] = useState(diagnostic?.title ?? "");
  const [description, setDescription] = useState(diagnostic?.description ?? "");
  const [trackId, setTrackId] = useState(diagnostic?.trackId ?? "");
  const [perSubject, setPerSubject] = useState("5");
  const save = useSaveMutation(async () => {
    const pool = (questions.data ?? []).filter((q) => !trackId || (subjects.data ?? []).some((s) => s.id === q.subjectId && s.trackId === trackId));
    // A spread across subjects and difficulty: up to N per subject, easy → hard.
    const bySubject = new Map<string, Question[]>();
    for (const q of pool) bySubject.set(q.subjectId ?? "none", [...(bySubject.get(q.subjectId ?? "none") ?? []), q]);
    const n = Number(perSubject);
    const chosen = [...bySubject.values()].flatMap((qs) => {
      const sorted = [...qs].sort((a, b) => a.difficulty - b.difficulty);
      if (sorted.length <= n) return sorted;
      return Array.from({ length: n }, (_, i) => sorted[Math.round((i * (sorted.length - 1)) / Math.max(1, n - 1))]!);
    });
    await saveDiagnostic({ title, description, trackId: trackId || null, questionIds: [...new Set(chosen.map((q) => q.id))] }, diagnostic?.id);
  }, onClose);
  return (
    <FormModal open={open} onClose={onClose} title="New diagnostic test" submitLabel="Create" submitting={save.isPending} formError={save.formError} onSubmit={() => save.mutate(undefined)}>
      <TextField label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} error={save.fieldErrors.title} placeholder="e.g. MSc preparation check" />
      <TextAreaField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Questions from" value={trackId} onChange={(e) => setTrackId(e.target.value)} options={[{ value: "", label: "Whole question bank" }, ...(tracks.data ?? []).map((t) => ({ value: t.id, label: t.title }))]} />
        <SelectField label="Per subject" value={perSubject} onChange={(e) => setPerSubject(e.target.value)} options={["3", "5", "8", "10"].map((n) => ({ value: n, label: `${n} questions` }))} hint="Spread from easy to hard" />
      </div>
      {save.fieldErrors.questionIds && <p className="text-sm text-danger">{save.fieldErrors.questionIds}</p>}
    </FormModal>
  );
}

export function DiagnosticsTab() {
  const navigate = useNavigate();
  const diagnostics = useDiagnostics();
  const sessions = useQuizSessions();
  const [creating, setCreating] = useState(false);
  const remove = useConfirmAction((d: Diagnostic) => deleteDiagnostic(d.id));
  const runs = (sessions.data ?? []).filter((s) => s.kind === "diagnostic" && s.finishedAt);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">A diagnostic measures your level across subjects without feedback, then shows strong and weak areas and builds a study plan.</p>
        <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          New diagnostic
        </Button>
      </div>
      {(diagnostics.data ?? []).length === 0 ? (
        <Card>
          <EmptyState icon={<ClipboardCheck className="size-5" />} title="No diagnostics yet" description="Create one from your question bank, or install a content pack that includes one." />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {(diagnostics.data ?? []).map((d) => (
            <Card key={d.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{d.title}</p>
                  <p className="text-xs text-subtle">{d.questionIds.length} questions</p>
                </div>
                <IconButton label="Delete diagnostic" onClick={() => remove.ask(d)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
              {d.description && <p className="text-[13px] text-muted">{d.description}</p>}
              <Button variant="primary" icon={<Play className="size-4" />} onClick={() => navigate(`/practice/quiz?diagnostic=${d.id}`)}>
                Take diagnostic
              </Button>
            </Card>
          ))}
        </div>
      )}
      {runs.length > 0 && (
        <Card>
          <h3 className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">Past results</h3>
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.id}>
                <Link to={`/practice/diagnostics/results/${r.id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-surface-2">
                  <span>{r.title}</span>
                  <span className="text-muted tabular-nums">
                    {formatDate(dateOf(r.startedAt))} · {r.score != null ? `${Math.round(r.score * 100)}%` : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <DiagnosticForm open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog open={remove.target != null} title="Delete diagnostic?" busy={remove.busy} error={remove.error} onClose={remove.cancel} onConfirm={remove.confirm} message={<p>Past results are kept.</p>} />
    </div>
  );
}

// ------------------------------------------------------------------ mastery

const BAND_TONE = { new: "neutral", weak: "danger", developing: "warning", strong: "accent", mastered: "success" } as const;

export function MasteryTab() {
  const navigate = useNavigate();
  const mastery = useTopicMastery();
  const [subject, setSubject] = useState("");
  const list = useMemo(() => (mastery.data ?? []).filter((t) => !subject || t.subject === subject), [mastery.data, subject]);
  const subjects = [...new Set((mastery.data ?? []).map((t) => t.subject).filter((s): s is string => !!s))].sort();
  const priority = list.filter((t) => t.mastery != null && t.mastery < 70).slice(0, 3);

  if (mastery.isPending) return <Spinner />;
  if (!list.length)
    return (
      <Card>
        <EmptyState icon={<Target className="size-5" />} title="No mastery data yet" description="Mastery (0–100) is calculated per topic from your quiz answers and flashcard reviews. Give questions a topic and start practising." />
      </Card>
    );

  return (
    <div className="flex flex-col gap-4">
      {priority.length > 0 && (
        <Card className="border-warning/40 p-4">
          <p className="mb-2 text-sm font-medium">Priority</p>
          <div className="flex flex-wrap gap-2">
            {priority.map((t) => (
              <Button key={t.topicId} size="sm" icon={<Play className="size-3.5" />} onClick={() => navigate(`/practice/quiz?topic=${t.topicId}&title=${encodeURIComponent(t.name)}`)}>
                {t.name} · {t.mastery}%
              </Button>
            ))}
          </div>
        </Card>
      )}
      {subjects.length > 1 && (
        <select aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9 w-64 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none">
          <option value="">All subjects</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
      <Card>
        <ul className="divide-y divide-border">
          {list.map((t) => {
            const band = masteryBand(t.mastery);
            return (
              <li key={t.topicId} className="grid grid-cols-[1fr_12rem_6rem_auto] items-center gap-4 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm">{t.name}</p>
                  <p className="text-xs text-subtle">
                    {t.subject ? `${t.subject} · ` : ""}
                    {t.attempts} answers · {t.reviews} card reviews
                  </p>
                </div>
                <ProgressBar value={(t.mastery ?? 0) / 100} label={`${t.name} mastery`} />
                <span className="text-right text-sm tabular-nums">
                  {t.mastery ?? "—"}
                  {t.mastery != null && "%"} <Badge tone={BAND_TONE[band]}>{band}</Badge>
                </span>
                <IconButton label={`Practise ${t.name}`} onClick={() => navigate(`/practice/quiz?topic=${t.topicId}&title=${encodeURIComponent(t.name)}`)}>
                  <Play className="size-3.5" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      </Card>
      <p className="text-xs text-subtle">Mastery weighs recent answers most and needs several correct answers to reach 90%+. Results older than two months gradually count less.</p>
    </div>
  );
}

// ------------------------------------------------------------------ history

export function HistoryTab() {
  const sessions = useQuizSessions();
  const list = (sessions.data ?? []).filter((s) => s.answered > 0);
  if (sessions.isPending) return <Spinner />;
  return (
    <Card>
      {list.length === 0 ? (
        <EmptyState icon={<History className="size-5" />} title="No quizzes yet" />
      ) : (
        <ul className="divide-y divide-border">
          {list.map((s) => (
            <li key={s.id} className="flex items-center gap-4 px-4 py-2.5 text-sm">
              <span className="w-28 text-xs text-muted tabular-nums">
                {formatDate(dateOf(s.startedAt), { day: "numeric", month: "short" })} {timeOf(s.startedAt)}
              </span>
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
              <Badge>{s.kind}</Badge>
              <span className="w-20 text-right text-xs text-muted">{s.answered} answered</span>
              <span className={clsx("w-12 text-right font-medium tabular-nums", (s.score ?? 0) >= 0.8 ? "text-success" : (s.score ?? 0) < 0.5 ? "text-danger" : "")}>
                {s.score != null ? `${Math.round(s.score * 100)}%` : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
