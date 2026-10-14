import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGA } from "../helpers/loadGA.js";

// Whole-chain research run: EVERY background script from manifest.json, in
// manifest order (so a load-order slip fails here, not in the browser), a fake
// `browser`, and a fake fetch that plays an OpenAI-format model calling
// web_search (DuckDuckGo fixture) and read_page (article fixture) before
// answering. Asserts the port traffic the content side consumes.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const manifest = JSON.parse(read("manifest.json"));

const RUST_URL = "https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html?a=1&b=2";

function sse(events) {
  return events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") + "data: [DONE]\n\n";
}
// One network read per SSE event, like a real stream — so text shown before a
// tool call is genuinely "on screen" when the call arrives.
function eventStream(body) {
  const enc = new TextEncoder();
  const pieces = body.split(/(?<=\n\n)/);
  return new ReadableStream({
    start(controller) {
      for (const p of pieces) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
}
function toolTurn(id, name, args) {
  return sse([
    { choices: [{ delta: { role: "assistant", content: "Let me look. " } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "" } }],
          },
        },
      ],
    },
    {
      choices: [
        { delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] } },
      ],
    },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  ]);
}
function textTurn(text) {
  return sse([
    { choices: [{ delta: { content: text.slice(0, 5) } }] },
    { choices: [{ delta: { content: text.slice(5) } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
  ]);
}

function setup(settings) {
  let onConnect;
  const browser = {
    runtime: {
      id: "ext-id",
      getURL: (p) => "moz-extension://x/" + p,
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onConnect: {
        addListener(fn) {
          onConnect = fn;
        },
      },
      onMessage: { addListener() {} },
    },
    contextMenus: {
      removeAll: () => Promise.resolve(),
      create() {},
      onClicked: { addListener() {} },
    },
    tabs: { sendMessage: () => Promise.resolve() },
    storage: { local: { get: () => Promise.resolve({ "ga:settings": settings }) } },
    permissions: { contains: () => Promise.resolve(true) },
  };
  const requests = [];
  let modelTurn = 0;
  const turns = [
    toolTurn("call_1", "web_search", { query: "rust borrowing" }),
    toolTurn("call_2", "read_page", { url: RUST_URL }),
    textTurn("Borrowing lets you reference without owning [1]. See also [2]."),
  ];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    if (url.indexOf("https://api.openai.com/") === 0) {
      return new Response(eventStream(turns[modelTurn++]), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    if (url.indexOf("https://html.duckduckgo.com/html/") === 0) {
      return new Response(read("tests/fixtures/ddg-results.html"), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url === RUST_URL) {
      return new Response(read("tests/fixtures/article-page.html"), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    throw new Error("unexpected fetch " + url);
  };
  const GA = loadGA(manifest.background.scripts, { browser, fetch });
  const posted = [];
  let onMsg;
  const port = {
    name: GA.protocol.PORT_ASK,
    postMessage: (m) => posted.push(m),
    onDisconnect: { addListener() {} },
    onMessage: {
      addListener(fn) {
        onMsg = fn;
      },
    },
  };
  onConnect(port);
  return { GA, posted, requests, send: (m) => onMsg(m) };
}

describe("research mode end to end through the real background chain", () => {
  it("search -> read -> cited answer with a Sources block, all over the port", async () => {
    const { GA, posted, requests, send } = setup({
      researchProvider: "openai",
      openaiApiKey: "sk-test",
      openaiModel: "gpt-test",
    });
    const P = GA.protocol;
    await send({
      type: P.MSG_ASK,
      provider: "gemini",
      prompt: "What is borrowing?",
      research: true,
    });

    const frames = posted.filter((m) => m.type !== P.MSG_PING);
    const done = frames[frames.length - 1];
    expect(done.type).toBe(P.MSG_DONE);
    expect(done.research.provider).toBe("chatgpt");
    expect(done.research.model).toBe("gpt-test");
    expect(done.research).toMatchObject({ steps: 3, searches: 1, pages: 1 });
    // The read page is source [1] (registered by the search, marked read+cited).
    const s1 = done.research.sources.find((s) => s.n === 1);
    expect(s1).toMatchObject({ url: RUST_URL, read: true, cited: true });
    expect(done.research.sources.find((s) => s.n === 2).cited).toBe(true);
    expect(done.text).toContain("[1]");
    expect(done.text).toMatch(/\n---\nSources\n\[1\] .*— https:\/\/doc\.rust-lang\.org/);

    // Step frames in order, with the step fields on the message itself.
    const kinds = frames.filter((m) => m.type === P.MSG_STEP).map((m) => m.kind);
    expect(kinds).toEqual([
      "step",
      "note",
      "search",
      "results",
      "step",
      "note",
      "read",
      "read-done",
      "step",
      "final",
    ]);
    const results = frames.find((m) => m.kind === "results");
    expect(results.count).toBeGreaterThan(0);
    expect(results.sources[0]).toMatchObject({ n: 1, url: RUST_URL });
    const readDone = frames.find((m) => m.kind === "read-done");
    expect(readDone.n).toBe(1);
    expect(readDone.chars).toBeGreaterThan(0);

    // Preamble streamed, then retracted with an empty reset; the final answer
    // and the Sources block arrive as deltas the content side can append.
    const chunks = frames.filter((m) => m.type === P.MSG_CHUNK);
    expect(chunks[0]).toEqual({ type: P.MSG_CHUNK, delta: "Let me look. " });
    expect(chunks[1]).toEqual({ type: P.MSG_CHUNK, reset: true, text: "" });
    let acc = "";
    for (const c of chunks) acc = c.reset ? c.text : acc + c.delta;
    expect(acc).toBe(done.text);

    // Wire: search hit DDG without a key, page fetched without credentials,
    // and each model turn carried the previous tool result back.
    const ddg = requests.find((r) => r.url.includes("html.duckduckgo.com"));
    expect(ddg.init.credentials).toBe("omit");
    const page = requests.find((r) => r.url === RUST_URL);
    expect(page.init.credentials).toBe("omit");
    const model = requests.filter((r) => r.url.includes("api.openai.com"));
    expect(model).toHaveLength(3);
    const second = JSON.parse(model[1].init.body);
    const toolMsg = second.messages.find((m) => m.role === "tool");
    expect(toolMsg.tool_call_id).toBe("call_1");
    expect(toolMsg.content).toContain("[1]");
    expect(second.tools.map((t) => t.function.name)).toEqual(["web_search", "read_page"]);
    const third = JSON.parse(model[2].init.body);
    expect(third.messages.find((m) => m.tool_call_id === "call_2").content).toContain("Tides");
    expect(third.messages[0].role).toBe("system");
    expect(third.messages[0].content).toContain("read_page");
    expect(frames.some((m) => m.type === P.MSG_ERROR)).toBe(false);
  });

  it("fails early over the port when no research provider is configured", async () => {
    const { GA, posted, requests, send } = setup({});
    const P = GA.protocol;
    await send({ type: P.MSG_ASK, provider: "gemini", prompt: "x", research: true });
    expect(posted.find((m) => m.type === P.MSG_ERROR).message).toBe(
      "Pick a research provider in Marginalia's options.",
    );
    expect(requests).toHaveLength(0);
  });
});
