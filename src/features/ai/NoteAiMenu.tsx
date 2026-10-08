import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, Copy, HelpCircle, Layers, ListChecks, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Markdown } from "@/components/Markdown";
import type { Note } from "@/domain/types";
import type { DocNode } from "@/domain/noteContent";
import { docToMarkdown } from "@/domain/noteMarkdown";
import type { CardDraft, QuestionDraft } from "@/domain/aiPrompts";
import { aiExplain, aiFlashcards, aiImprove, aiQuestions, aiSummarize, saveAiFlashcards, saveAiQuestions, type AiResult } from "@/services/ai";
import { AiBadge, AiError, AiLoading, CardsReview, labelledNodes, QuestionsReview, TruncatedWarning, useAiRun } from "./AiParts";

type Action = "summarize" | "explain" | "improve" | "flashcards" | "quiz";

const ACTIONS: { id: Action; label: string; hint: string; icon: typeof Sparkles; needsSelection?: boolean }[] = [
  { id: "summarize", label: "Summarise", hint: "Selection, or the whole note", icon: BookOpenCheck },
  { id: "explain", label: "Explain selection", hint: "Intuition, explanation, example", icon: HelpCircle, needsSelection: true },
  { id: "improve", label: "Improve notes", hint: "Tidy up wording and structure", icon: Wand2 },
  { id: "flashcards", label: "Make flashcards", hint: "Review before saving", icon: Layers },
  { id: "quiz", label: "Make quiz questions", hint: "Added to the question bank", icon: ListChecks },
];

const TITLES: Record<Action, string> = {
  summarize: "AI summary",
  explain: "AI explanation",
  improve: "Improved notes (AI)",
  flashcards: "AI flashcards",
  quiz: "AI quiz questions",
};

interface Snapshot {
  /** Markdown sent to the model. */
  text: string;
  /** The whole note as Markdown (context for explanations). */
  whole: string;
  hasSelection: boolean;
  /** Top-level block range covering the selection. */
  from: number;
  to: number;
}

function snapshot(editor: Editor): Snapshot {
  const { state } = editor;
  const { from, to, empty, $from, $to } = state.selection;
  const whole = docToMarkdown(editor.getJSON() as DocNode);
  if (empty) return { text: whole, whole, hasSelection: false, from: 0, to: state.doc.content.size };
  const slice = state.doc.cut(from, to).toJSON() as DocNode;
  return {
    text: docToMarkdown(slice) || state.doc.textBetween(from, to, "\n"),
    whole,
    hasSelection: true,
    from: $from.depth >= 1 ? $from.before(1) : from,
    to: $to.depth >= 1 ? $to.after(1) : to,
  };
}

type Payload = { kind: "text"; result: AiResult } | { kind: "cards"; cards: (CardDraft & { keep: boolean })[]; label: string; truncated: boolean } | { kind: "quiz"; questions: QuestionDraft[]; keep: boolean[]; dropped: number; label: string };

export function NoteAiMenu({ editor, note }: { editor: Editor | null; note: Note }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const run = useAiRun<Payload>();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (run.state.status === "done") setPayload(run.state.value);
  }, [run.state]);

  const generate = (a: Action, s: Snapshot) =>
    void run.start(async (): Promise<Payload> => {
      switch (a) {
        case "summarize":
          return { kind: "text", result: await aiSummarize(s.text, note.title) };
        case "explain":
          return { kind: "text", result: await aiExplain(s.text, s.whole) };
        case "improve":
          return { kind: "text", result: await aiImprove(s.text) };
        case "flashcards": {
          const r = await aiFlashcards(s.text, 10);
          return { kind: "cards", cards: r.cards.map((c) => ({ ...c, keep: true })), label: r.label, truncated: r.truncated };
        }
        case "quiz": {
          const r = await aiQuestions(s.text, 6);
          return { kind: "quiz", questions: r.questions, keep: r.questions.map(() => true), dropped: r.dropped, label: r.label };
        }
      }
    });

  const choose = (a: Action) => {
    setOpen(false);
    if (!editor) return;
    const s = snapshot(editor);
    setSnap(s);
    setAction(a);
    setPayload(null);
    setSaved(null);
    generate(a, s);
  };

  const close = () => {
    setAction(null);
    setPayload(null);
    run.reset();
  };

  const insert = (mode: "below" | "replace") => {
    if (!editor || !snap || payload?.kind !== "text") return;
    const nodes = labelledNodes(payload.result.label, payload.result.text);
    const size = editor.state.doc.content.size;
    const chain = editor.chain().focus();
    if (mode === "replace") chain.insertContentAt({ from: Math.min(snap.from, size), to: Math.min(snap.to, size) }, nodes).run();
    else chain.insertContentAt(snap.hasSelection ? Math.min(snap.to, size) : size, nodes).run();
    close();
  };

  const saveCards = async () => {
    if (payload?.kind !== "cards") return;
    setSaving(true);
    try {
      const keep = payload.cards.filter((c) => c.keep && c.front.trim() && c.back.trim());
      await saveAiFlashcards(keep, { courseId: note.courseId, noteId: note.id });
      await client.invalidateQueries();
      setSaved(`${keep.length} flashcards added. Find them under Flashcards (tag #ai-generated).`);
      setPayload(null);
    } catch (err) {
      setSaved(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveQuiz = async () => {
    if (payload?.kind !== "quiz") return;
    setSaving(true);
    try {
      const keep = payload.questions.filter((_, i) => payload.keep[i]);
      await saveAiQuestions(keep, { courseId: note.courseId, noteId: note.id }, payload.label);
      await client.invalidateQueries();
      setSaved(`${keep.length} questions added to the question bank (tag #ai-generated). Practise them from Practice → Questions.`);
      setPayload(null);
    } catch (err) {
      setSaved(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const hasSelection = editor ? !editor.state.selection.empty : false;
  const loading = run.state.status === "loading";

  const footer = (() => {
    if (!action) return null;
    const again = (
      <Button variant="ghost" disabled={loading || !snap} onClick={() => snap && generate(action, snap)}>
        Regenerate
      </Button>
    );
    if (saved) return <Button variant="primary" onClick={close}>Done</Button>;
    if (payload?.kind === "text")
      return (
        <>
          {again}
          <Button icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard.writeText(`${payload.result.text}\n\n_${payload.result.label}_`)}>
            Copy
          </Button>
          {action === "improve" ? (
            <Button variant="primary" onClick={() => insert("replace")}>
              {snap?.hasSelection ? "Replace selection" : "Replace note"}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => insert("below")}>
              {snap?.hasSelection ? "Insert below selection" : "Insert at end"}
            </Button>
          )}
        </>
      );
    if (payload?.kind === "cards")
      return (
        <>
          {again}
          <Button variant="primary" loading={saving} disabled={!payload.cards.some((c) => c.keep)} onClick={() => void saveCards()}>
            Save {payload.cards.filter((c) => c.keep).length} flashcards
          </Button>
        </>
      );
    if (payload?.kind === "quiz")
      return (
        <>
          {again}
          <Button variant="primary" loading={saving} disabled={!payload.keep.some(Boolean)} onClick={() => void saveQuiz()}>
            Add {payload.keep.filter(Boolean).length} questions
          </Button>
        </>
      );
    return (
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
    );
  })();

  return (
    <div ref={root} className="relative">
      <Button size="sm" variant="ghost" icon={<Sparkles className="size-4 text-accent" />} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        AI
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-xl">
          <p className="px-3 py-1.5 text-[11px] text-subtle">{hasSelection ? "Uses the selected text." : "Uses the whole note (select text to narrow it down)."} Only that text is sent.</p>
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              role="menuitem"
              type="button"
              disabled={a.needsSelection && !hasSelection}
              onClick={() => choose(a.id)}
              className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <a.icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              <span>
                <span className="block">{a.label}</span>
                <span className="block text-xs text-subtle">{a.needsSelection && !hasSelection ? "Select some text first" : a.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <Modal open={action != null} onClose={close} title={action ? TITLES[action] : ""} width="lg" footer={footer}>
        <div className="flex flex-col gap-3">
          {saved ? (
            <p className="text-sm">{saved}</p>
          ) : run.state.status === "loading" ? (
            <AiLoading what={action === "flashcards" ? "Writing flashcards" : action === "quiz" ? "Writing questions" : "Thinking"} />
          ) : run.state.status === "error" ? (
            <AiError message={run.state.message} onRetry={snap && action ? () => generate(action, snap) : undefined} />
          ) : payload?.kind === "text" ? (
            <>
              <AiBadge label={payload.result.label} />
              {payload.result.truncated && <TruncatedWarning />}
              <div className="max-h-[28rem] overflow-y-auto rounded-md border border-border p-3">
                <Markdown source={payload.result.text} className="text-sm" />
              </div>
            </>
          ) : payload?.kind === "cards" ? (
            <>
              <AiBadge label={payload.label} />
              <p className="text-xs text-muted">Edit or untick cards before saving. They are linked to this note and tagged #ai-generated.</p>
              <CardsReview cards={payload.cards} onChange={(cards) => setPayload({ ...payload, cards })} />
            </>
          ) : payload?.kind === "quiz" ? (
            <>
              <AiBadge label={payload.label} />
              {payload.dropped > 0 && <p className="text-xs text-warning">{payload.dropped} malformed question(s) were left out.</p>}
              <QuestionsReview questions={payload.questions} keep={payload.keep} onToggle={(i) => setPayload({ ...payload, keep: payload.keep.map((v, j) => (j === i ? !v : v)) })} />
            </>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
