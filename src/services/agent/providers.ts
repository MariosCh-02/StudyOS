/**
 * Translates the assistant's conversation (with tool calls) to and from the
 * chat formats of OpenAI, Anthropic and Ollama. Pure functions.
 */
import type { RemoteProvider } from "@/domain/aiPrompts";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ModelReply {
  text: string;
  toolCalls: ToolCall[];
  truncated: boolean;
}

export interface BodyOptions {
  provider: RemoteProvider;
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: ToolDef[];
  maxTokens: number;
}

const openAiTools = (tools: ToolDef[]) => tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

export function buildBody(o: BodyOptions): Record<string, unknown> {
  switch (o.provider) {
    case "openai":
      return {
        model: o.model,
        max_completion_tokens: o.maxTokens,
        messages: [
          { role: "system", content: o.system },
          ...o.messages.map((m) =>
            m.role === "tool"
              ? { role: "tool", tool_call_id: m.toolCallId, content: m.content }
              : m.role === "assistant" && m.toolCalls?.length
                ? { role: "assistant", content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
                : { role: m.role, content: m.content },
          ),
        ],
        ...(o.tools.length ? { tools: openAiTools(o.tools) } : {}),
      };

    case "anthropic": {
      // Anthropic: tool results go in a user message; consecutive results share one.
      const messages: { role: "user" | "assistant"; content: unknown }[] = [];
      for (const m of o.messages) {
        if (m.role === "tool") {
          const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
          const last = messages[messages.length - 1];
          if (last?.role === "user" && Array.isArray(last.content)) (last.content as unknown[]).push(block);
          else messages.push({ role: "user", content: [block] });
        } else if (m.role === "assistant") {
          const blocks = [...(m.content.trim() ? [{ type: "text", text: m.content }] : []), ...(m.toolCalls ?? []).map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.args }))];
          messages.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "…" }] });
        } else {
          messages.push({ role: "user", content: m.content });
        }
      }
      return {
        model: o.model,
        max_tokens: o.maxTokens,
        system: o.system,
        messages,
        ...(o.tools.length ? { tools: o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
      };
    }

    case "ollama":
      return {
        model: o.model,
        stream: false,
        // 8k context so instructions, tools and results aren't silently cut off;
        // keep the model loaded so follow-up messages don't reload it.
        options: { num_predict: o.maxTokens, num_ctx: 8192 },
        keep_alive: "30m",
        messages: [
          { role: "system", content: o.system },
          ...o.messages.map((m) =>
            m.role === "tool"
              ? { role: "tool", content: m.content, tool_name: m.name }
              : m.role === "assistant" && m.toolCalls?.length
                ? { role: "assistant", content: m.content, tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })) }
                : { role: m.role, content: m.content },
          ),
        ],
        ...(o.tools.length ? { tools: openAiTools(o.tools) } : {}),
      };
  }
}

const asArgs = (v: unknown): Record<string, unknown> => {
  if (typeof v === "string") {
    try {
      const parsed: unknown = JSON.parse(v || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};

let counter = 0;
const newCallId = () => `call_${Date.now().toString(36)}_${(counter++).toString(36)}`;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function parseReply(provider: RemoteProvider, raw: unknown): ModelReply {
  const r = obj(raw);
  switch (provider) {
    case "openai": {
      const choice = obj(arr(r.choices)[0]);
      const msg = obj(choice.message);
      return {
        text: typeof msg.content === "string" ? msg.content : "",
        toolCalls: arr(msg.tool_calls).map((c) => {
          const f = obj(obj(c).function);
          return { id: String(obj(c).id ?? newCallId()), name: String(f.name ?? ""), args: asArgs(f.arguments) };
        }),
        truncated: choice.finish_reason === "length",
      };
    }
    case "anthropic": {
      const blocks = arr(r.content).map(obj);
      return {
        text: blocks
          .filter((b) => b.type === "text")
          .map((b) => String(b.text ?? ""))
          .join(""),
        toolCalls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: String(b.id ?? newCallId()), name: String(b.name ?? ""), args: asArgs(b.input) })),
        truncated: r.stop_reason === "max_tokens",
      };
    }
    case "ollama": {
      const msg = obj(r.message);
      return {
        text: typeof msg.content === "string" ? msg.content : "",
        toolCalls: arr(msg.tool_calls).map((c) => {
          const f = obj(obj(c).function);
          return { id: newCallId(), name: String(f.name ?? ""), args: asArgs(f.arguments) };
        }),
        truncated: r.done_reason === "length",
      };
    }
  }
}

/** The model or provider can't use tools (e.g. a small Ollama model). */
export const toolsUnsupported = (err: unknown): boolean => /does not support tools|tools? (?:are |is )?not supported|tool use is not supported|support(?:s)? function calling/i.test(err instanceof Error ? err.message : String(err));
