import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";
import { scaleFromPreset } from "../src/domain/grading";
import { buildBody, parseReply, toolsUnsupported, type AgentMessage } from "../src/services/agent/providers";
import { runAgent, setChatTransport, trimHistory } from "../src/services/agent/agent";
import { runTool, TOOL_DEFS } from "../src/services/agent/tools";
import { setSetting } from "../src/services/settings";
import { createInstitution } from "../src/services/institutions";
import { createProgramme } from "../src/services/programmes";
import { createCourse } from "../src/services/courses";
import { createNote, saveNote } from "../src/services/notes";
import { createExam } from "../src/services/assessments";

const convo: AgentMessage[] = [
  { role: "user", content: "When is my exam?" },
  { role: "assistant", content: "Let me check.", toolCalls: [{ id: "c1", name: "get_deadlines", args: { days: 60 } }] },
  { role: "tool", toolCallId: "c1", name: "get_deadlines", content: '{"exams":[]}' },
];

describe("provider formats", () => {
  const tools = TOOL_DEFS.slice(0, 1);
  it("builds OpenAI requests with tool calls and results", () => {
    const b = buildBody({ provider: "openai", model: "m", system: "sys", messages: convo, tools, maxTokens: 100 }) as any;
    expect(b.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(b.messages[2].tool_calls[0]).toEqual({ id: "c1", type: "function", function: { name: "get_deadlines", arguments: '{"days":60}' } });
    expect(b.messages[3]).toEqual({ role: "tool", tool_call_id: "c1", content: '{"exams":[]}' });
    expect(b.tools[0].function.name).toBe("get_overview");
  });

  it("builds Anthropic requests with tool_use and grouped tool_result blocks", () => {
    const two: AgentMessage[] = [...convo.slice(0, 1), { role: "assistant", content: "", toolCalls: [{ id: "a", name: "x", args: {} }, { id: "b", name: "y", args: {} }] }, { role: "tool", toolCallId: "a", name: "x", content: "1" }, { role: "tool", toolCallId: "b", name: "y", content: "2" }];
    const b = buildBody({ provider: "anthropic", model: "m", system: "sys", messages: two, tools, maxTokens: 100 }) as any;
    expect(b.system).toBe("sys");
    expect(b.messages[1]).toEqual({ role: "assistant", content: [{ type: "tool_use", id: "a", name: "x", input: {} }, { type: "tool_use", id: "b", name: "y", input: {} }] });
    expect(b.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "1" }, { type: "tool_result", tool_use_id: "b", content: "2" }] });
    expect(b.tools[0].input_schema.type).toBe("object");
  });

  it("builds Ollama requests", () => {
    const b = buildBody({ provider: "ollama", model: "m", system: "sys", messages: convo, tools, maxTokens: 100 }) as any;
    expect(b.stream).toBe(false);
    expect(b.messages[2].tool_calls[0]).toEqual({ function: { name: "get_deadlines", arguments: { days: 60 } } });
    expect(b.messages[3]).toEqual({ role: "tool", content: '{"exams":[]}', tool_name: "get_deadlines" });
  });

  it("parses replies from every provider", () => {
    expect(parseReply("openai", { choices: [{ message: { content: null, tool_calls: [{ id: "x", function: { name: "get_overview", arguments: "{}" } }] }, finish_reason: "tool_calls" }] })).toMatchObject({ text: "", toolCalls: [{ id: "x", name: "get_overview", args: {} }] });
    expect(parseReply("anthropic", { content: [{ type: "text", text: "Hi" }, { type: "tool_use", id: "t", name: "list_tasks", input: { status: "open" } }], stop_reason: "tool_use" })).toMatchObject({ text: "Hi", toolCalls: [{ id: "t", name: "list_tasks", args: { status: "open" } }] });
    expect(parseReply("ollama", { message: { content: "", tool_calls: [{ function: { name: "get_grades", arguments: {} } }] } }).toolCalls[0]!.name).toBe("get_grades");
    expect(parseReply("openai", { choices: [{ message: { tool_calls: [{ id: "x", function: { name: "f", arguments: "not json" } }] } }] }).toolCalls[0]!.args).toEqual({});
  });

  it("recognises models without tool support", () => {
    expect(toolsUnsupported(new Error("Ollama request failed (400). Details: registry.ollama.ai/library/gemma:2b does not support tools"))).toBe(true);
    expect(toolsUnsupported(new Error("Ollama rejected the API key"))).toBe(false);
  });

  it("keeps the latest turns without dangling tool messages", () => {
    const h: AgentMessage[] = [];
    for (let i = 0; i < 20; i++) h.push({ role: "user", content: `q${i}` }, { role: "assistant", content: `a${i}` });
    const t = trimHistory([...h, ...convo], 3);
    expect(t[0]).toEqual({ role: "user", content: "q18" });
    expect(t[t.length - 1]).toEqual({ role: "user", content: "When is my exam?" });
    expect(t.some((m) => m.role === "tool")).toBe(false);
  });
});

describe("the assistant", () => {
  let courseId: string;
  let calls: { body: any }[];

  beforeEach(async () => {
    await createTestDb();
    calls = [];
    const i = await createInstitution({ name: "University of Cyprus", kind: "university", country: null, website: null, notes: null });
    const p = await createProgramme({ institutionId: i.id, name: "MSc Artificial Intelligence", level: "master", status: "active", field: null, startDate: "2026-09-01", endDate: "2028-06-30", totalCredits: 120, creditUnit: "ECTS", gradingScale: scaleFromPreset("ten_point"), targetGrade: 8, color: null, notes: null });
    await setSetting("activeProgrammeId", p.id);
    courseId = (await createCourse({ programmeId: p.id, semesterId: null, name: "Machine Learning", code: "MAI611", credits: 10, lecturer: null, lecturerEmail: null, location: null, status: "in_progress", finalGrade: null, targetGrade: null, color: null, description: null })).id;
    await setSetting("aiProvider", "anthropic");
    await setSetting("aiModel", "claude-opus-5-5");
  });
  afterEach(() => setChatTransport(null));

  it("looks things up with tools and answers in conversation", async () => {
    const n = await createNote({ courseId, title: "Gradient descent" });
    await saveNote(n.id, "Gradient descent", JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Use a learning rate of 0.01 for the lab." }] }] }));
    const script = [
      { content: [{ type: "tool_use", id: "t1", name: "search_my_data", input: { query: "gradient descent" } }], stop_reason: "tool_use" },
      { content: [{ type: "tool_use", id: "t2", name: "read_item", input: { type: "note", id: n.id } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Your note **Gradient descent** says to use a learning rate of 0.01." }], stop_reason: "end_turn" },
    ];
    setChatTransport(async (_cfg, body) => {
      calls.push({ body });
      return script[calls.length - 1];
    });
    const steps: string[] = [];
    const r = await runAgent([{ role: "user", content: "What learning rate did I note for gradient descent?" }], { onStep: (s) => steps.push(s.summary) });
    expect(r.text).toContain("0.01");
    expect(r.mode).toBe("tools");
    expect(steps).toEqual(["Searched your data for “gradient descent” (1 match)", "Read your note “Gradient descent”"]);
    expect(r.sources).toEqual([{ label: "Gradient descent", href: `/notes/${n.id}` }]);
    expect(r.label).toMatch(/^AI-generated with Anthropic/);
    // The tool result was sent back to the model.
    expect(JSON.stringify(calls[2]!.body.messages)).toContain("learning rate of 0.01");
    expect(calls[0]!.body.system).toContain("Never guess or invent their data");
  });

  it("answers programme questions from the overview tool", async () => {
    setChatTransport(async (_cfg, body: any) => {
      calls.push({ body });
      if (calls.length === 1) return { content: [{ type: "tool_use", id: "o", name: "get_overview", input: {} }], stop_reason: "tool_use" };
      const result = JSON.stringify(body.messages);
      return { content: [{ type: "text", text: result.includes("2028-06-30") ? "Your MSc runs until 30 June 2028." : "unknown" }], stop_reason: "end_turn" };
    });
    const r = await runAgent([{ role: "user", content: "How long will my course take?" }]);
    expect(r.text).toBe("Your MSc runs until 30 June 2028.");
  });

  it("chats without tools when none are needed", async () => {
    setChatTransport(async () => ({ content: [{ type: "text", text: "I'm doing well, thanks! What are we studying today?" }], stop_reason: "end_turn" }));
    const r = await runAgent([{ role: "user", content: "how are you?" }]);
    expect(r.text).toMatch(/studying today/);
    expect(r.steps).toEqual([]);
  });

  it("falls back to retrieved context for models without tool support", async () => {
    await setSetting("aiProvider", "ollama");
    await setSetting("aiModel", "tiny-model");
    await createExam({ courseId, title: "ML Final", kind: "final", startAt: "2027-01-15T09:00", durationMinutes: 120, location: null, topics: [], notes: null, weight: 60, score: null, maxScore: null });
    setChatTransport(async (_cfg, body: any) => {
      calls.push({ body });
      if (body.tools) throw new Error("Ollama request failed (400). Details: registry.ollama.ai/library/tiny-model does not support tools");
      return { message: { content: "Your ML Final is on 15 January 2027." }, done_reason: "stop" };
    });
    const r = await runAgent([{ role: "user", content: "When is the ML Final exam?" }]);
    expect(r.mode).toBe("context");
    expect(r.text).toContain("15 January 2027");
    expect(calls[1]!.body.messages[0].content).toContain("MSc Artificial Intelligence");
    // Remembered: the next question goes straight to context mode.
    await runAgent([{ role: "user", content: "hi" }]);
    expect(calls[2]!.body.tools).toBeUndefined();
  });

  it("stops after a bounded number of tool rounds", async () => {
    setChatTransport(async () => ({ content: [{ type: "tool_use", id: String(Math.random()), name: "list_tasks", input: {} }], stop_reason: "tool_use" }));
    const r = await runAgent([{ role: "user", content: "loop forever" }]);
    expect(r.steps.length).toBe(6);
    expect(r.text).toMatch(/couldn't finish/);
  });

  it("reports unknown tools and bad arguments back to the model instead of crashing", async () => {
    expect(JSON.parse((await runTool("delete_everything", {})).content)).toEqual({ error: "Unknown tool delete_everything" });
    expect(JSON.parse((await runTool("read_item", { type: "note", id: "nope" })).content).error).toMatch(/No note/);
    const s = JSON.parse((await runTool("get_schedule", { from: "garbage", to: "2099-01-01" })).content);
    expect(s.to <= "2099-01-01").toBe(true);
  });
});

describe("local models", () => {
  beforeEach(async () => {
    await createTestDb();
    await setSetting("aiProvider", "ollama");
    await setSetting("aiModel", "llama3.2");
  });
  afterEach(() => setChatTransport(null));

  it("sends a compact, stable prompt with a larger context window", async () => {
    const bodies: any[] = [];
    setChatTransport(async (_cfg, body) => {
      bodies.push(body);
      return { message: { content: "Hi there!" }, done_reason: "stop" };
    });
    await runAgent([{ role: "user", content: "hello" }]);
    await runAgent([{ role: "user", content: "hello again" }]);
    expect(bodies[0].options.num_ctx).toBe(8192);
    expect(bodies[0].keep_alive).toBe("30m");
    // Same instructions and tools both times (lets Ollama reuse what it already read), and no time of day.
    expect(bodies[1].messages[0].content).toBe(bodies[0].messages[0].content);
    expect(JSON.stringify(bodies[1].tools)).toBe(JSON.stringify(bodies[0].tools));
    expect(bodies[0].messages[0].content).not.toMatch(/\d{2}:\d{2}/);
    expect(bodies[0].messages[0].content.length).toBeLessThan(700);
  });

  it("turns a tool call written as text into a real lookup, and answers greetings plainly", async () => {
    const script = [
      { message: { content: '{"name": "list_tasks", "parameters": {"status": "open"}}' } },
      { message: { content: "You have no open tasks." } },
    ];
    let i = 0;
    setChatTransport(async () => script[i++]);
    const r = await runAgent([{ role: "user", content: "what are my tasks?" }]);
    expect(r.steps.map((s) => s.tool)).toEqual(["list_tasks"]);
    expect(r.text).toBe("You have no open tasks.");

    const bodies: any[] = [];
    const greet = [{ message: { content: '{"name": "hello", "parameters": {}}' } }, { message: { content: "Hi! I'm doing well. What are we studying today?" } }];
    let j = 0;
    setChatTransport(async (_cfg, body) => {
      bodies.push(body);
      return greet[j++];
    });
    const g = await runAgent([{ role: "user", content: "hello! how are you?" }]);
    expect(g.text).toMatch(/studying today/);
    expect(bodies[1].tools).toBeUndefined();
  });

  it("streams text but hides tool-call JSON and lookup rounds", async () => {
    const shown: string[] = [];
    let n = 0;
    setChatTransport(async (_cfg, _body, opts) => {
      n++;
      if (n === 1) {
        opts?.onToken?.('{"name": "list_tasks"');
        return { message: { content: '{"name": "list_tasks", "parameters": {}}' } };
      }
      opts?.onToken?.("All ");
      opts?.onToken?.("done!");
      return { message: { content: "All done!" } };
    });
    await runAgent([{ role: "user", content: "tasks?" }], { onText: (t) => shown.push(t) });
    expect(shown.filter((t) => t.includes("{"))).toEqual([]);
    expect(shown[shown.length - 1]).toBe("All done!");
  });

  it("recognises tool calls written as text", async () => {
    const { pseudoToolCall } = await import("../src/services/agent/agent");
    expect(pseudoToolCall('```json\n{"name": "get_grades", "arguments": {}}\n```')).toMatchObject({ name: "get_grades", args: {} });
    expect(pseudoToolCall("Your average is {great}.")).toBeNull();
    expect(pseudoToolCall("Hello!")).toBeNull();
  });
});
