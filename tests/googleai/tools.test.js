import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

const GA = loadGA(["src/googleai/payload.js", "src/googleai/tools.js"]);
const tools = GA.googleai.tools;

const DEFS = [
  { name: "web_search", description: "Search", parameters: { type: "object" } },
  { name: "read_page", description: "Read", parameters: { type: "object" } },
];

const ev = (parts, finishReason) => ({
  candidates: [{ content: { role: "model", parts }, ...(finishReason ? { finishReason } : {}) }],
});
const fc = (name, args, extra) => ({ functionCall: { name, args }, ...(extra || {}) });

function run(events) {
  const c = tools.makeCursor();
  const pushed = events.map((e) => c.push(e));
  return { c, pushed, turn: c.end() };
}

describe("googleai tools: buildRequest", () => {
  it("streams to the model's SSE endpoint with the key in a header", () => {
    const req = tools.buildRequest("gemini-2.5-flash", "gk", tools.initConvo("q"), DEFS, {
      system: "S",
      toolChoice: "auto",
    });
    expect(req.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
    );
    expect(req.url).not.toContain("gk");
    expect(req.headers["x-goog-api-key"]).toBe("gk");
    const body = JSON.parse(req.body);
    expect(body).toEqual({
      systemInstruction: { parts: [{ text: "S" }] },
      contents: [{ role: "user", parts: [{ text: "q" }] }],
      tools: [
        {
          functionDeclarations: [
            { name: "web_search", description: "Search", parameters: { type: "object" } },
            { name: "read_page", description: "Read", parameters: { type: "object" } },
          ],
        },
      ],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    });
  });

  it("mode NONE, and no tools/toolConfig for empty defs", () => {
    const none = JSON.parse(tools.buildRequest("m", "k", [], DEFS, { toolChoice: "none" }).body);
    expect(none.toolConfig.functionCallingConfig.mode).toBe("NONE");
    const empty = JSON.parse(tools.buildRequest("m", "k", [], [], {}).body);
    expect(empty).not.toHaveProperty("tools");
    expect(empty).not.toHaveProperty("toolConfig");
  });
});

describe("googleai tools: cursor", () => {
  it("text-only turn (thought parts skipped)", () => {
    const { c, pushed, turn } = run([
      ev([{ text: "thinking", thought: true }]),
      ev([{ text: "Hel" }]),
      ev([{ text: "lo" }], "STOP"),
    ]);
    expect(pushed).toEqual([null, "Hel", "Hello"]);
    expect(c.hasToolCalls()).toBe(false);
    expect(turn).toEqual({ text: "Hello", toolCalls: [], stop: "STOP" });
  });

  it("one tool call kept raw (thoughtSignature) with a minted id", () => {
    const part = fc("web_search", { query: "x" }, { thoughtSignature: "sig" });
    const c = tools.makeCursor();
    c.push(ev([part]));
    expect(c.hasToolCalls()).toBe(true);
    c.push(ev([], "STOP"));
    expect(c.end().toolCalls).toEqual([
      { id: "web_search#0", name: "web_search", args: { query: "x" }, raw: part },
    ]);
  });

  it("two parallel calls across events; missing args -> {}; non-object -> null", () => {
    const { turn } = run([
      ev([{ text: "Look." }, fc("web_search", { query: "a" })]),
      ev([fc("read_page")]),
      ev([fc("web_search", "oops")], "STOP"),
    ]);
    expect(turn.text).toBe("Look.");
    expect(turn.toolCalls.map((t) => [t.id, t.args])).toEqual([
      ["web_search#0", { query: "a" }],
      ["read_page#1", {}],
      ["web_search#2", null],
    ]);
  });

  it("MALFORMED_FUNCTION_CALL finishes as text-only", () => {
    const { turn } = run([ev([{ text: "partial" }]), ev([], "MALFORMED_FUNCTION_CALL")]);
    expect(turn).toEqual({ text: "partial", toolCalls: [], stop: "MALFORMED_FUNCTION_CALL" });
  });

  it("an error event makes end() throw", () => {
    const c = tools.makeCursor();
    c.push({ error: { code: 429, message: "Resource exhausted" } });
    expect(() => c.end()).toThrow("Resource exhausted");
  });
});

describe("googleai tools: convo", () => {
  it("full round-trip echoes raw call parts and shapes functionResponses", () => {
    const a = fc("web_search", { query: "q" }, { thoughtSignature: "sig" });
    const b = fc("read_page", { url: "https://x.test" });
    const convo = tools.initConvo("question");
    const { turn } = run([ev([{ text: "Looking." }, a]), ev([b], "STOP")]);
    tools.appendAssistant(convo, turn);
    tools.appendToolResults(convo, [
      { id: turn.toolCalls[0].id, name: "web_search", content: "results", isError: false },
      { id: turn.toolCalls[1].id, name: "read_page", content: "blocked", isError: true },
    ]);
    tools.appendUser(convo, "Answer now.");
    expect(convo).toEqual([
      { role: "user", parts: [{ text: "question" }] },
      { role: "model", parts: [{ text: "Looking." }, a, b] },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "web_search", response: { result: "results" } } },
          { functionResponse: { name: "read_page", response: { error: "blocked" } } },
          { text: "Answer now." },
        ],
      },
    ]);
    const body = JSON.parse(tools.buildRequest("m", "k", convo, DEFS, { system: "S" }).body);
    expect(body.contents).toEqual(convo);
  });

  it("omits an empty text part; appendUser after a model turn adds a user turn", () => {
    const convo = [];
    tools.appendAssistant(convo, {
      text: "",
      toolCalls: [{ id: "x#0", name: "x", args: { a: 1 } }],
    });
    expect(convo[0]).toEqual({
      role: "model",
      parts: [{ functionCall: { name: "x", args: { a: 1 } } }],
    });
    tools.appendUser(convo, "more");
    expect(convo[1]).toEqual({ role: "user", parts: [{ text: "more" }] });
  });
});
