/**
 * The StudyOS assistant: a conversational agent on top of the student's
 * chosen model. It looks things up with read-only tools (tools.ts) instead
 * of guessing, keeps the conversation, and falls back to retrieved context
 * for models that can't use tools.
 *
 * Local models (Ollama) are often slow to read long prompts, especially on a
 * CPU, so for them the assistant uses a compact prompt, smaller lookup
 * results and fewer rounds, streams the reply as it is written, and keeps the
 * prompt's start unchanged between requests so Ollama can reuse what it has
 * already read.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import { aiLabel } from "@/domain/aiPrompts";
import { formatDate, toDateKey } from "@/domain/dates";
import { getAiConfig, retrieve, type AiConfig } from "../ai";
import { getProfile } from "../settings";
import { resultHref, SEARCH_TYPE_LABELS } from "../search";
import { buildBody, parseReply, toolsUnsupported, type AgentMessage, type ToolCall, type ToolDef } from "./providers";
import { runTool, TOOL_DEFS, type Source } from "./tools";

export type { AgentMessage } from "./providers";
export type { Source } from "./tools";

export interface TransportOptions {
  /** Lets `cancelAgent` stop the request. */
  requestId?: string;
  /** Text as it is generated (streamed from Ollama). */
  onToken?: (delta: string) => void;
}

/** Sends one provider-format chat request. Swappable in tests. */
export type ChatTransport = (cfg: AiConfig, body: Record<string, unknown>, opts?: TransportOptions) => Promise<unknown>;
const defaultTransport: ChatTransport = async (cfg, body, opts = {}) => {
  const onToken = new Channel<string>();
  onToken.onmessage = (delta) => opts.onToken?.(delta);
  try {
    return await invoke("ai_chat", { provider: cfg.provider, baseUrl: cfg.baseUrl, body, requestId: opts.requestId ?? null, onToken });
  } catch (err) {
    throw new Error(typeof err === "string" ? err : err instanceof Error ? err.message : "The AI request failed.");
  }
};
let transport: ChatTransport = defaultTransport;
export const setChatTransport = (t: ChatTransport | null) => {
  transport = t ?? defaultTransport;
};

/** Stops a running answer (the Stop button); the model stops generating too. */
export async function cancelAgent(requestId: string): Promise<void> {
  try {
    await invoke("ai_cancel", { requestId });
  } catch {
    // Already finished.
  }
}

export interface AgentStep {
  tool: string;
  summary: string;
}

export interface AgentResult {
  text: string;
  steps: AgentStep[];
  sources: Source[];
  /** "AI-generated with … — check it" label. */
  label: string;
  truncated: boolean;
  /** "tools" normally; "context" when the model can't use tools. */
  mode: "tools" | "context";
}

const MAX_TOOL_ROUNDS = 6;
const LOCAL_TOOL_ROUNDS = 3;
/** Lookup results are cut to this size for local models (each character has to be read). */
const LOCAL_RESULT_CHARS = 3500;
const MAX_TOKENS = 2000;
/** Earlier turns kept in the conversation sent to the model. */
const HISTORY_TURNS = 12;
const LOCAL_HISTORY_TURNS = 6;

/** Remembers models that rejected tools, so later messages skip straight to context mode. */
const noToolModels = new Set<string>();

/** Short tool descriptions for local models: the first sentence only. */
const compactTools = (tools: ToolDef[]): ToolDef[] => tools.map((t) => ({ ...t, description: t.description.split(/(?<=\.)\s/)[0]! }));

export async function systemPrompt(now = new Date(), compact = false): Promise<string> {
  const { displayName } = await getProfile().catch(() => ({ displayName: "" }));
  const who = displayName ? `${displayName}'s` : "the student's";
  // Date only (no time of day): an unchanged prompt lets local models reuse what they already read.
  const today = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (compact) {
    return [
      `You are the StudyOS assistant, a friendly study companion in ${who} study app. Today is ${today}.`,
      "Be warm and concise; use Markdown. For anything about their own studies (courses, notes, deadlines, exams, grades, schedule, tasks), call a tool; never invent their data. For greetings or general questions, just answer.",
      "You may explain concepts from your own knowledge. Never claim to be official course material.",
    ].join("\n");
  }
  return [
    `You are the StudyOS assistant, a friendly and knowledgeable study companion inside StudyOS, ${who} personal academic app.`,
    `Today is ${today}.`,
    "",
    "How to help:",
    "- Talk naturally and warmly, like a helpful tutor. Keep answers concise and well structured; use Markdown, and LaTeX ($...$, $$...$$) for maths.",
    "- For anything about the student's own studies (programmes, courses, notes, lectures, deadlines, exams, grades, schedule, tasks, study time, progress, projects, papers), use the tools to look it up. Never guess or invent their data. If the tools don't have it, say so plainly.",
    "- Look things up efficiently: get_overview for general questions, search_my_data with a few keywords, then read_item for details.",
    "- When you use their data, mention where it came from (the note, course or item name).",
    "- You can also explain concepts, solve problems and give study advice from your own knowledge. Say when something is general knowledge rather than from their notes.",
    "- Never present your answers as official university, lecturer or course material, and never invent sources.",
    "- Do calculations carefully (e.g. days until a date, credits remaining, required grades) and show the key numbers.",
  ].join("\n");
}

/** Keeps the latest turns, always starting at a user message and without tool exchanges. */
export function trimHistory(history: AgentMessage[], turns = HISTORY_TURNS): AgentMessage[] {
  const kept = history.filter((m) => m.role === "user" || (m.role === "assistant" && !m.toolCalls?.length));
  let users = 0;
  let start = kept.length;
  for (let i = kept.length - 1; i >= 0; i--) {
    if (kept[i]!.role !== "user") continue;
    if (++users > turns) break;
    start = i; // always start at a user message
  }
  return kept.slice(start);
}

/** Context for models without tool support: an overview plus the items most relevant to the question. */
async function contextFor(question: string, maxItemChars: number): Promise<{ text: string; sources: Source[] }> {
  const overview = await runTool("get_overview", {});
  const hits = await retrieve(question, 5);
  const parts = [`<overview>\n${overview.content.slice(0, maxItemChars)}\n</overview>`];
  const sources: Source[] = [];
  for (const h of hits) {
    const item = ["note", "lecture", "assignment", "exam", "concept", "paper", "project", "lesson"].includes(h.type) ? await runTool("read_item", { type: h.type, id: h.id }) : null;
    parts.push(`<item kind="${SEARCH_TYPE_LABELS[h.type]}" title="${(h.title || "Untitled").replace(/"/g, "'")}">\n${item ? item.content.slice(0, Math.min(2500, maxItemChars)) : h.snippet}\n</item>`);
    sources.push({ label: h.title || "Untitled", href: await resultHref(h) });
  }
  return { text: parts.join("\n\n"), sources };
}

/**
 * A tool call written as plain JSON text, e.g. `{"name": "get_overview", "parameters": {}}`
 * (some small models do this instead of a real tool call). Null for normal text.
 */
export function pseudoToolCall(text: string): ToolCall | null {
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  if (!t.startsWith("{") || !t.endsWith("}") || t.length > 2000) return null;
  try {
    const v = JSON.parse(t) as { name?: unknown; parameters?: unknown; arguments?: unknown };
    if (typeof v.name !== "string" || !v.name) return null;
    const args = v.parameters ?? v.arguments ?? {};
    return { id: `call_text_${Date.now().toString(36)}`, name: v.name, args: args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {} };
  } catch {
    return null;
  }
}

const dedupe = (sources: Source[]) => [...new Map(sources.map((s) => [s.href, s])).values()].slice(0, 8);

/**
 * Answers the last user message in `history`. `onStep` is called as tools
 * run (the "Searched your notes…" lines); `onText` receives the reply text as
 * it streams in (local models), and is reset when a round turns out to be a lookup.
 */
export async function runAgent(
  history: AgentMessage[],
  opts: { onStep?: (s: AgentStep) => void; onText?: (text: string) => void; requestId?: string } = {},
): Promise<AgentResult> {
  const cfg = await getAiConfig();
  if (!cfg) throw new Error("Turn on AI in Settings → AI and choose a model first.");
  const local = cfg.provider === "ollama";
  const label = aiLabel(cfg.provider, cfg.model, formatDate(toDateKey(new Date())));
  const system = await systemPrompt(new Date(), local);
  const tools = local ? compactTools(TOOL_DEFS) : TOOL_DEFS;
  const maxRounds = local ? LOCAL_TOOL_ROUNDS : MAX_TOOL_ROUNDS;
  const resultChars = local ? LOCAL_RESULT_CHARS : Infinity;
  const messages = trimHistory(history, local ? LOCAL_HISTORY_TURNS : HISTORY_TURNS);
  const last = messages[messages.length - 1];
  if (last?.role !== "user") throw new Error("There is no question to answer.");

  const steps: AgentStep[] = [];
  const sources: Source[] = [];
  const modelKey = `${cfg.provider}:${cfg.model}`;

  // Streams one round's text to the UI.
  const call = async (body: Record<string, unknown>) => {
    let streamed = "";
    opts.onText?.("");
    return transport(cfg, body, {
      requestId: opts.requestId,
      onToken: (delta) => {
        streamed += delta;
        // Don't show a tool call a small model writes out as JSON text.
        if (!streamed.trimStart().startsWith("{")) opts.onText?.(streamed);
      },
    });
  };

  const answerWithContext = async (): Promise<AgentResult> => {
    const step = { tool: "context", summary: "Gathered the most relevant items from your data" };
    steps.push(step);
    opts.onStep?.(step);
    const ctx = await contextFor(last.content, local ? LOCAL_RESULT_CHARS : 6000);
    sources.push(...ctx.sources);
    const body = buildBody({
      provider: cfg.provider,
      model: cfg.model,
      system: `${system}\n\nYou can't look things up yourself in this conversation; here is the student's data most relevant to their latest message. Use only it for facts about their studies.\n\n${ctx.text}`,
      messages,
      tools: [],
      maxTokens: MAX_TOKENS,
    });
    const reply = parseReply(cfg.provider, await call(body));
    return { text: reply.text.trim() || "I couldn't come up with an answer. Could you rephrase that?", steps, sources: dedupe(sources), label, truncated: reply.truncated, mode: "context" };
  };

  if (noToolModels.has(modelKey)) return answerWithContext();

  const convo: AgentMessage[] = [...messages];
  let plainRetried = false;
  for (let round = 0; round <= maxRounds; round++) {
    const body = buildBody({ provider: cfg.provider, model: cfg.model, system, messages: convo, tools, maxTokens: MAX_TOKENS });
    let raw: unknown;
    try {
      raw = await call(body);
    } catch (err) {
      if (round === 0 && toolsUnsupported(err)) {
        noToolModels.add(modelKey);
        return answerWithContext();
      }
      throw err;
    }
    const reply = parseReply(cfg.provider, raw);
    let calls: ToolCall[] = reply.toolCalls.filter((c) => c.name);
    // Small local models sometimes write a tool call as plain text instead of calling it.
    const pseudo = !calls.length ? pseudoToolCall(reply.text) : null;
    if (pseudo) {
      if (tools.some((t) => t.name === pseudo.name)) {
        calls = [pseudo];
        reply.text = "";
      } else if (!plainRetried) {
        // Not a real tool (e.g. {"name": "hello"} for a greeting): ask once more without tools.
        plainRetried = true;
        const plain = parseReply(cfg.provider, await call(buildBody({ provider: cfg.provider, model: cfg.model, system, messages: convo, tools: [], maxTokens: MAX_TOKENS })));
        return { text: plain.text.trim() || "Hi! How can I help with your studies?", steps, sources: dedupe(sources), label, truncated: plain.truncated, mode: "tools" };
      }
    }
    if (!calls.length || round === maxRounds) {
      const text = reply.text.trim() || (calls.length ? "I looked through quite a lot and couldn't finish. Could you ask a bit more specifically?" : "I'm not sure what to say to that. Could you rephrase?");
      return { text, steps, sources: dedupe(sources), label, truncated: reply.truncated, mode: "tools" };
    }
    opts.onText?.(""); // this round was a lookup, not the answer
    convo.push({ role: "assistant", content: reply.text, toolCalls: calls });
    for (const c of calls) {
      const result = await runTool(c.name, c.args);
      const step = { tool: c.name, summary: result.summary };
      steps.push(step);
      opts.onStep?.(step);
      sources.push(...result.sources);
      const content = result.content.length > resultChars ? `${result.content.slice(0, resultChars)} …[shortened]` : result.content;
      convo.push({ role: "tool", toolCallId: c.id, name: c.name, content });
    }
  }
  // Unreachable: the loop always returns on its last round.
  throw new Error("The assistant stopped unexpectedly.");
}
