import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { Check, MessageCircleQuestion, RotateCcw, Search, SendHorizontal, Sparkles, Square, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Markdown } from "@/components/Markdown";
import { Snippet } from "@/features/search/SearchPage";
import { useAiEnabled } from "@/features/ai/AiParts";
import { useSettings } from "@/hooks/queries";
import { ask, type AnswerItem } from "@/services/ask";
import { cancelAgent, runAgent, type AgentMessage, type AgentStep, type Source } from "@/services/agent/agent";

interface Entry {
  id: string;
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  /** Reply text streaming in while pending. */
  draft?: string;
  startedAt?: number;
  error?: string;
  steps?: AgentStep[];
  sources?: Source[];
  /** Local (non-AI) answers list matching items. */
  items?: AnswerItem[];
  label?: string;
  truncated?: boolean;
  stopped?: boolean;
}

const STORE_KEY = "studyos.assistant.chat";
const MAX_STORED = 60;

const load = (): Entry[] => {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as Entry[];
    return Array.isArray(v) ? v.filter((e) => !e.pending) : [];
  } catch {
    return [];
  }
};
const store = (entries: Entry[]) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(entries.filter((e) => !e.pending).slice(-MAX_STORED)));
  } catch {
    // Remembering the chat is a convenience only.
  }
};

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const AI_SUGGESTIONS = [
  "What should I focus on this week?",
  "How am I doing in my courses?",
  "When is my next exam, and what's on it?",
  "What did I write about gradient descent?",
  "Explain backpropagation simply",
  "How long until I finish my programme?",
];
const LOCAL_SUGGESTIONS = [
  "When is my Machine Learning exam?",
  "What assignments are due this month?",
  "What did I write about gradient descent?",
  "Show me everything I marked as confusing",
  "Which topics have I not reviewed?",
  "What's my current average?",
];

const SMALL_TALK = /^\s*(hi|hello|hey|hiya|good (morning|afternoon|evening)|how are you|how's it going|thanks?|thank you|cheers)\b/i;
const LOCAL_HELP =
  "Hi! Without AI turned on I can answer questions about your own data: exam dates, deadlines, grades, your next class, open tasks, weak topics and what you wrote about something. Try one of the suggestions.\n\nFor a full conversation (follow-up questions, explanations, study advice), turn on AI in **Settings → AI**.";

/** Turns finished chat entries into the conversation the model sees. */
function toHistory(entries: Entry[]): AgentMessage[] {
  return entries
    .filter((e) => !e.pending && !e.error && !e.stopped && e.text.trim())
    .map((e) => (e.role === "user" ? { role: "user" as const, content: e.text } : { role: "assistant" as const, content: e.text }));
}

function Steps({ steps, live }: { steps: AgentStep[]; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  if (!live && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mb-2 flex items-center gap-1 text-[11px] text-subtle hover:text-muted">
        <Search className="size-3" aria-hidden /> Looked up {steps.length} {steps.length === 1 ? "thing" : "things"}
      </button>
    );
  }
  return (
    <ul className="mb-2 flex flex-col gap-0.5 text-[11px] text-subtle">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-1.5">
          {live && i === steps.length - 1 ? <Search className="size-3 animate-pulse text-accent" aria-hidden /> : <Check className="size-3" aria-hidden />}
          {s.summary}
        </li>
      ))}
    </ul>
  );
}

/** After a while, explain that local models can be slow (so it doesn't look stuck). */
function SlowHint({ startedAt }: { startedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = startedAt ? Math.round((now - startedAt) / 1000) : 0;
  if (secs < 12) return null;
  return (
    <p className="mt-2 text-[11px] text-subtle">
      Still working ({secs} s). Local models without a graphics card can take a minute or two; a faster model in Settings → AI helps.
    </p>
  );
}

function Typing() {
  return (
    <span className="flex items-center gap-1 py-1" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 150}ms` }} />
      ))}
    </span>
  );
}

export default function AskPage() {
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const aiEnabled = useAiEnabled();
  const [entries, setEntries] = useState<Entry[]>(load);
  const [text, setText] = useState("");
  const busy = entries.some((e) => e.pending);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(new Set<string>());

  useEffect(() => {
    store(entries);
  }, [entries]);

  // Keep the newest message in view. Block body: smooth scrolling returns a Promise in WebView2.
  useEffect(() => {
    const main = end.current?.closest("main");
    if (main) main.scrollTo({ top: main.scrollHeight, behavior: "smooth" });
  }, [entries]);

  const update = (id: string, patch: Partial<Entry> | ((e: Entry) => Partial<Entry>)) =>
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...(typeof patch === "function" ? patch(e) : patch) } : e)));

  const send = async (question: string, base: Entry[] = entries) => {
    const q = question.trim();
    if (!q || base.some((e) => e.pending)) return;
    setText("");
    const answerId = newId();
    const history = [...toHistory(base), { role: "user" as const, content: q }];
    setEntries([...base, { id: newId(), role: "user", text: q }, { id: answerId, role: "assistant", text: "", pending: true, steps: [], startedAt: Date.now() }]);
    try {
      if (aiEnabled) {
        const r = await runAgent(history, {
          requestId: answerId,
          onStep: (s) => {
            if (!cancelled.current.has(answerId)) update(answerId, (e) => ({ steps: [...(e.steps ?? []), s] }));
          },
          onText: (draft) => {
            if (!cancelled.current.has(answerId)) update(answerId, { draft });
          },
        });
        if (cancelled.current.has(answerId)) return;
        update(answerId, { pending: false, draft: undefined, text: r.text, steps: r.steps, sources: r.sources, label: r.label, truncated: r.truncated });
      } else if (SMALL_TALK.test(q) && q.length < 40) {
        update(answerId, { pending: false, text: LOCAL_HELP });
      } else {
        const a = await ask(q);
        update(answerId, { pending: false, text: a.text, items: a.items });
      }
    } catch (err) {
      if (cancelled.current.has(answerId)) return;
      update(answerId, { pending: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      requestAnimationFrame(() => input.current?.focus());
    }
  };

  const stop = () => {
    const pending = entries.find((e) => e.pending);
    if (!pending) return;
    cancelled.current.add(pending.id);
    void cancelAgent(pending.id); // also stops the model generating
    update(pending.id, { pending: false, stopped: true, text: pending.draft ?? "", draft: undefined });
  };

  /** Asks the question before a failed answer again. */
  const retry = (assistantId: string) => {
    const i = entries.findIndex((e) => e.id === assistantId);
    const question = entries[i - 1];
    if (!question || question.role !== "user") return;
    void send(
      question.text,
      entries.filter((e) => e.id !== assistantId && e.id !== question.id),
    );
  };

  // Questions handed over from the Ctrl+K palette.
  useEffect(() => {
    const q = params.get("q");
    if (q && settings.data) {
      void send(q);
      setParams({}, { replace: true });
    }
  }, [params, settings.data]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(text);
    }
  };

  const suggestions = aiEnabled ? AI_SUGGESTIONS : LOCAL_SUGGESTIONS;
  const model = settings.data?.aiModel;

  return (
    <>
      <PageHeader
        title="Ask My Studies"
        subtitle={
          aiEnabled
            ? "Your study assistant: it looks things up in your StudyOS data, remembers the conversation and can explain topics."
            : "Questions about your courses, exams, deadlines, grades and notes, answered from your data on this computer."
        }
        actions={
          entries.length > 0 && (
            <Button
              icon={<Trash2 className="size-4" />}
              disabled={busy}
              onClick={() => {
                cancelled.current.clear();
                setEntries([]);
              }}
            >
              New chat
            </Button>
          )
        }
      />
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {!aiEnabled && (
          <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-muted">
            <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
            <span>
              For a real conversation (follow-ups, explanations, study advice), turn on AI in{" "}
              <Link to="/settings" className="text-accent hover:underline">
                Settings → AI
              </Link>
              .
            </span>
          </p>
        )}

        {entries.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
              <MessageCircleQuestion className="size-6" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-semibold">How can I help with your studies?</h2>
              <p className="text-sm text-muted">{aiEnabled ? "Ask anything. I'll look things up in your courses, notes and calendar." : "Try one of these:"}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((q) => (
                <button key={q} type="button" onClick={() => void send(q)} className="rounded-full border border-border px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-fg">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {entries.map((e) =>
          e.role === "user" ? (
            <p key={e.id} className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-accent px-4 py-2 text-sm whitespace-pre-wrap text-accent-fg select-text">
              {e.text}
            </p>
          ) : (
            <div key={e.id} className="flex max-w-[92%] gap-2.5 self-start">
              <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent" aria-hidden>
                <Sparkles className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-border bg-surface px-4 py-3 select-text">
                {e.steps && <Steps steps={e.steps} live={e.pending} />}
                {e.pending ? (
                  <>
                    {e.draft ? <Markdown source={e.draft} className="text-sm" /> : <Typing />}
                    <SlowHint startedAt={e.startedAt} />
                  </>
                ) : e.stopped ? (
                  <>
                    {e.text && <Markdown source={e.text} className="mb-1 text-sm" />}
                    <p className="text-sm text-subtle italic">Stopped.</p>
                  </>
                ) : e.error ? (
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-sm text-danger">{e.error}</p>
                    <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => retry(e.id)}>
                      Try again
                    </Button>
                  </div>
                ) : (
                  <>
                    <Markdown source={e.text} className="text-sm" />
                    {e.truncated && <p className="mt-2 text-xs text-warning">The answer hit the length limit and may be cut off.</p>}
                    {e.items && e.items.length > 0 && (
                      <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                        {e.items.map((it, j) => (
                          <li key={j}>
                            {it.href ? (
                              <Link to={it.href} className="block px-3 py-2 hover:bg-surface-2">
                                <span className="block text-sm">{it.label}</span>
                                {it.detail && <Snippet text={it.detail} className="line-clamp-2 text-xs text-muted" />}
                              </Link>
                            ) : (
                              <span className="block px-3 py-2 text-sm">{it.label}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {e.sources && e.sources.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {e.sources.map((s) => (
                          <Link key={s.href} to={s.href} className="max-w-56 truncate rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] text-muted hover:text-accent">
                            {s.label}
                          </Link>
                        ))}
                      </div>
                    )}
                    {e.label && (
                      <p className="mt-2 text-[10px] text-subtle" title={e.label}>
                        AI-generated{model ? ` · ${model}` : ""} · not official course material
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          ),
        )}
        <div ref={end} />

        <form onSubmit={onSubmit} className="sticky bottom-4 flex items-end gap-2 rounded-xl border border-border bg-surface p-2 shadow-lg">
          <label className="sr-only" htmlFor="ask-input">
            Your message
          </label>
          <textarea
            id="ask-input"
            ref={input}
            autoFocus
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={aiEnabled ? "Message your study assistant… (Shift+Enter for a new line)" : "Ask about your studies…"}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm placeholder:text-subtle focus:outline-none"
            style={{ height: `${Math.min(160, 40 + Math.max(0, text.split("\n").length - 1) * 20)}px` }}
          />
          {busy ? (
            <Button icon={<Square className="size-3.5" />} onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button type="submit" variant="primary" icon={<SendHorizontal className="size-4" />} disabled={!text.trim()}>
              Send
            </Button>
          )}
        </form>
        <p className="text-center text-xs text-subtle">
          {aiEnabled
            ? "The assistant looks up only what each question needs and sends it to your AI provider. Check important details against your course material."
            : "Answers come from your stored data only. Nothing leaves this computer."}
        </p>
      </div>
    </>
  );
}
