import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Research-mode adapter: requests, convo reshaping, and the cursor folding
// parsed Chat Completions SSE events into one turn.
const GA = loadGA(["src/openai/payload.js", "src/openai/tools.js"]);
const tools = GA.openai.tools;

const DEFS = [
  { name: "web_search", description: "Search", parameters: { type: "object" } },
  { name: "read_page", description: "Read", parameters: { type: "object" } },
];

const text = (s) => ({ choices: [{ delta: { content: s } }] });
const call = (index, fn, id) => ({
  choices: [
    { delta: { tool_calls: [{ index, ...(id ? { id, type: "function" } : {}), function: fn }] } },
  ],
});
const finish = (r) => ({ choices: [{ delta: {}, finish_reason: r }] });

function run(events) {
  const c = tools.makeCursor();
  const pushed = events.map((e) => c.push(e));
  return { c, pushed, turn: c.end() };
}

describe("openai tools: buildRequest", () => {
  it("prepends the system prompt, maps tool defs, sets tool_choice", () => {
    const convo = tools.initConvo("q");
    const req = tools.buildRequest("gpt-4o", "sk-k", convo, DEFS, {
      system: "S",
      toolChoice: "auto",
    });
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(req.headers.Authorization).toBe("Bearer sk-k");
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({ model: "gpt-4o", stream: true, tool_choice: "auto" });
    expect(body.messages).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "q" },
    ]);
    expect(body.tools[0]).toEqual({
      type: "function",
      function: { name: "web_search", description: "Search", parameters: { type: "object" } },
    });
  });

  it("passes tool_choice none", () => {
    const body = JSON.parse(tools.buildRequest("m", "k", [], DEFS, { toolChoice: "none" }).body);
    expect(body.tool_choice).toBe("none");
    expect(body.tools).toHaveLength(2);
  });

  it("omits tools and tool_choice when there are no tool defs", () => {
    const body = JSON.parse(tools.buildRequest("m", "k", [], [], { system: "S" }).body);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });
});

describe("openai tools: cursor", () => {
  it("text-only turn returns accumulated text per text event", () => {
    const { c, pushed, turn } = run([
      { choices: [{ delta: { role: "assistant" } }] },
      text("Hel"),
      text("lo"),
      finish("stop"),
    ]);
    expect(pushed).toEqual([null, "Hel", "Hello", null]);
    expect(c.hasToolCalls()).toBe(false);
    expect(turn).toEqual({ text: "Hello", toolCalls: [], stop: "stop" });
  });

  it("one tool call with split argument fragments", () => {
    const c = tools.makeCursor();
    c.push(call(0, { name: "web_search", arguments: "" }, "call_1"));
    expect(c.hasToolCalls()).toBe(true);
    c.push(call(0, { arguments: '{"que' }));
    c.push(call(0, { arguments: 'ry":"x"}' }));
    c.push(finish("tool_calls"));
    const turn = c.end();
    expect(turn.stop).toBe("tool_calls");
    expect(turn.toolCalls).toEqual([
      {
        id: "call_1",
        name: "web_search",
        args: { query: "x" },
        raw: {
          id: "call_1",
          type: "function",
          function: { name: "web_search", arguments: '{"query":"x"}' },
        },
      },
    ]);
  });

  it("two parallel tool calls merge by index", () => {
    const { turn } = run([
      text("Let me look."),
      call(0, { name: "web_search", arguments: '{"query":' }, "a"),
      call(1, { name: "read_page", arguments: "" }, "b"),
      call(1, { arguments: '{"url":"https://x.test"}' }),
      call(0, { arguments: '"q"}' }),
      finish("tool_calls"),
    ]);
    expect(turn.text).toBe("Let me look.");
    expect(turn.toolCalls.map((t) => [t.id, t.name, t.args])).toEqual([
      ["a", "web_search", { query: "q" }],
      ["b", "read_page", { url: "https://x.test" }],
    ]);
  });

  it("malformed args -> null; empty args -> {}", () => {
    const { turn } = run([
      call(0, { name: "web_search", arguments: '{"query":' }, "a"),
      call(1, { name: "read_page", arguments: "" }, "b"),
    ]);
    expect(turn.toolCalls[0].args).toBeNull();
    expect(turn.toolCalls[1].args).toEqual({});
  });

  it("an error event fails the turn in end()", () => {
    const c = tools.makeCursor();
    c.push(text("x"));
    c.push({ error: { message: "Provider returned error" } });
    expect(() => c.end()).toThrow("Provider returned error");
  });

  it("tolerates usage-only chunks and junk", () => {
    const { turn } = run([{ choices: [], usage: {} }, null, "x", text("ok")]);
    expect(turn.text).toBe("ok");
  });
});

describe("openai tools: convo", () => {
  it("appendAssistant/appendToolResults shapes and a full round-trip", () => {
    const convo = tools.initConvo("question");
    const turn = run([
      call(0, { name: "web_search", arguments: '{"query":"q"}' }, "a"),
      call(1, { name: "read_page", arguments: "{bad" }, "b"),
    ]).turn;
    tools.appendAssistant(convo, turn);
    tools.appendToolResults(convo, [
      { id: "a", name: "web_search", content: "results", isError: false },
      { id: "b", name: "read_page", content: "arguments were not valid JSON", isError: true },
    ]);
    tools.appendUser(convo, "Answer now.");
    expect(convo).toEqual([
      { role: "user", content: "question" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "a",
            type: "function",
            function: { name: "web_search", arguments: '{"query":"q"}' },
          },
          { id: "b", type: "function", function: { name: "read_page", arguments: "{bad" } },
        ],
      },
      { role: "tool", tool_call_id: "a", content: "results" },
      { role: "tool", tool_call_id: "b", content: "ERROR: arguments were not valid JSON" },
      { role: "user", content: "Answer now." },
    ]);
    const body = JSON.parse(tools.buildRequest("m", "k", convo, DEFS, { system: "S" }).body);
    expect(body.messages.slice(1)).toEqual(convo);
  });

  it("omits tool_calls for a text-only assistant turn; synthesizes from args without raw", () => {
    const convo = [];
    tools.appendAssistant(convo, { text: "hi", toolCalls: [] });
    tools.appendAssistant(convo, {
      text: "",
      toolCalls: [{ id: "x", name: "web_search", args: { query: "q" } }],
    });
    expect(convo[0]).toEqual({ role: "assistant", content: "hi" });
    expect(convo[1].tool_calls[0].function.arguments).toBe('{"query":"q"}');
  });

  it("exposes make and a label", () => {
    expect(tools.label).toBe("OpenAI");
    expect(typeof tools.make).toBe("function");
  });
});
