import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

const GA = loadGA(["src/anthropic/payload.js", "src/anthropic/tools.js"]);
const tools = GA.anthropic.tools;

const DEFS = [
  { name: "web_search", description: "Search", parameters: { type: "object" } },
  { name: "read_page", description: "Read", parameters: { type: "object" } },
];

const start = (index, content_block) => ({ type: "content_block_start", index, content_block });
const textDelta = (index, text) => ({
  type: "content_block_delta",
  index,
  delta: { type: "text_delta", text },
});
const jsonDelta = (index, partial_json) => ({
  type: "content_block_delta",
  index,
  delta: { type: "input_json_delta", partial_json },
});
const stopBlock = (index) => ({ type: "content_block_stop", index });
const msgStop = (stop_reason) => ({ type: "message_delta", delta: { stop_reason } });
const toolUse = (id, name) => ({ type: "tool_use", id, name, input: {} });

function run(events) {
  const c = tools.makeCursor();
  const pushed = events.map((e) => c.push(e));
  return { c, pushed, turn: c.end() };
}

describe("anthropic tools: buildRequest", () => {
  it("uses the ask path's endpoint + headers and maps tool defs", () => {
    const req = tools.buildRequest("claude-x", "ak", tools.initConvo("q"), DEFS, {
      system: "S",
      toolChoice: "auto",
    });
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers).toMatchObject({
      "x-api-key": "ak",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    });
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({
      model: "claude-x",
      max_tokens: 4096,
      stream: true,
      system: "S",
      messages: [{ role: "user", content: "q" }],
      tool_choice: { type: "auto" },
    });
    expect(body.tools[1]).toEqual({
      name: "read_page",
      description: "Read",
      input_schema: { type: "object" },
    });
  });

  it("tool_choice none, and no tools/tool_choice for empty defs", () => {
    const none = JSON.parse(tools.buildRequest("m", "k", [], DEFS, { toolChoice: "none" }).body);
    expect(none.tool_choice).toEqual({ type: "none" });
    const empty = JSON.parse(tools.buildRequest("m", "k", [], [], { toolChoice: "none" }).body);
    expect(empty).not.toHaveProperty("tools");
    expect(empty).not.toHaveProperty("tool_choice");
  });
});

describe("anthropic tools: cursor", () => {
  it("text-only turn", () => {
    const { c, pushed, turn } = run([
      { type: "message_start", message: {} },
      start(0, { type: "text", text: "" }),
      textDelta(0, "Hel"),
      { type: "ping" },
      textDelta(0, "lo"),
      stopBlock(0),
      msgStop("end_turn"),
      { type: "message_stop" },
    ]);
    expect(pushed).toEqual([null, null, "Hel", null, "Hello", null, null, null]);
    expect(c.hasToolCalls()).toBe(false);
    expect(turn).toEqual({ text: "Hello", toolCalls: [], stop: "end_turn" });
  });

  it("one tool call with split partial_json after preamble text", () => {
    const c = tools.makeCursor();
    c.push(start(0, { type: "text", text: "" }));
    c.push(textDelta(0, "Searching."));
    c.push(stopBlock(0));
    expect(c.hasToolCalls()).toBe(false);
    c.push(start(1, toolUse("tu_1", "web_search")));
    expect(c.hasToolCalls()).toBe(true);
    c.push(jsonDelta(1, ""));
    c.push(jsonDelta(1, '{"query'));
    c.push(jsonDelta(1, '":"x"}'));
    c.push(stopBlock(1));
    c.push(msgStop("tool_use"));
    expect(c.end()).toEqual({
      text: "Searching.",
      toolCalls: [{ id: "tu_1", name: "web_search", args: { query: "x" } }],
      stop: "tool_use",
    });
  });

  it("two parallel tool calls; malformed -> null; empty -> {}", () => {
    const { turn } = run([
      start(0, toolUse("a", "web_search")),
      jsonDelta(0, '{"query":'),
      stopBlock(0),
      start(1, toolUse("b", "read_page")),
      stopBlock(1),
      msgStop("tool_use"),
    ]);
    expect(turn.toolCalls).toEqual([
      { id: "a", name: "web_search", args: null },
      { id: "b", name: "read_page", args: {} },
    ]);
  });

  it("an error event makes end() throw with the provider message", () => {
    const c = tools.makeCursor();
    c.push(start(0, { type: "text", text: "" }));
    c.push({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
    expect(() => c.end()).toThrow("Overloaded");
  });
});

describe("anthropic tools: convo", () => {
  it("full round-trip: assistant blocks, one tool_result message, final nudge", () => {
    const convo = tools.initConvo("question");
    const { turn } = run([
      start(0, { type: "text", text: "" }),
      textDelta(0, "Looking."),
      start(1, toolUse("a", "web_search")),
      jsonDelta(1, '{"query":"q"}'),
      start(2, toolUse("b", "read_page")),
      jsonDelta(2, "{bad"),
      msgStop("tool_use"),
    ]);
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
        content: [
          { type: "text", text: "Looking." },
          { type: "tool_use", id: "a", name: "web_search", input: { query: "q" } },
          { type: "tool_use", id: "b", name: "read_page", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "a", content: "results" },
          {
            type: "tool_result",
            tool_use_id: "b",
            content: "arguments were not valid JSON",
            is_error: true,
          },
          { type: "text", text: "Answer now." },
        ],
      },
    ]);
    const body = JSON.parse(tools.buildRequest("m", "k", convo, DEFS, { system: "S" }).body);
    expect(body.messages).toEqual(convo);
  });

  it("omits an empty text block; appendUser after an assistant turn adds a message", () => {
    const convo = [];
    tools.appendAssistant(convo, {
      text: "",
      toolCalls: [{ id: "a", name: "web_search", args: { query: "q" } }],
    });
    expect(convo[0].content).toEqual([
      { type: "tool_use", id: "a", name: "web_search", input: { query: "q" } },
    ]);
    tools.appendUser(convo, "more");
    expect(convo[1]).toEqual({ role: "user", content: "more" });
    tools.appendUser(convo, "again");
    expect(convo[1].content).toEqual([
      { type: "text", text: "more" },
      { type: "text", text: "again" },
    ]);
  });
});
