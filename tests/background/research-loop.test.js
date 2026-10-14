import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// research-loop.js with everything injected: a fake adapter speaking a toy
// event format ({t:"text"} / {call:{id,name,args}}), fake tools, and a fake
// fetch serving one scripted SSE body per model turn.

function load() {
  return loadGA([
    "src/shared/config.js",
    "src/shared/sse.js",
    "src/background/api-util.js",
    "src/core/research.js",
    "src/background/research-loop.js",
  ]);
}

function fakeAdapter() {
  const requests = [];
  return {
    label: "Fake",
    requests,
    buildRequest(model, key, convo, toolDefs, opts) {
      requests.push({
        model,
        key,
        convo: convo.slice(),
        tools: toolDefs.map((d) => d.name),
        toolChoice: opts.toolChoice,
        system: opts.system,
      });
      return { url: "https://fake.test/v1", headers: { k: key }, body: "{}" };
    },
    initConvo: (text) => [{ user: text }],
    appendUser: (convo, text) => convo.push({ user: text }),
    appendAssistant: (convo, turn) => convo.push({ assistant: turn.text, calls: turn.toolCalls }),
    appendToolResults: (convo, results) => convo.push({ results }),
    makeCursor() {
      let text = "";
      let err = null;
      const calls = [];
      return {
        push(ev) {
          if (ev.error) err = ev.error;
          if (ev.call) calls.push(ev.call);
          if (typeof ev.t === "string") {
            text += ev.t;
            return text;
          }
          return null;
        },
        hasToolCalls: () => calls.length > 0,
        end() {
          if (err) throw new Error(err);
          return { text, toolCalls: calls, stop: calls.length ? "tool_use" : "end" };
        },
      };
    },
  };
}

const text = (t) => ({ t });
const call = (id, name, args) => ({ call: { id, name, args } });

// One Response per turn; each event is its own body chunk so text streams.
function sseRes(events) {
  const enc = new TextEncoder();
  const chunks = events.map((e) => enc.encode("data: " + JSON.stringify(e) + "\n\n"));
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () =>
          Promise.resolve(i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }),
      }),
    },
  };
}

function scriptedFetch(turns) {
  const seen = [];
  const fetchImpl = (url, init) => {
    seen.push({ url, init });
    const next = turns.shift();
    if (!next) throw new Error("unexpected extra model turn");
    return Promise.resolve(typeof next === "function" ? next(init) : sseRes(next));
  };
  return { fetchImpl, seen };
}

function fakeTools(GA, over) {
  const sources = GA.core.research.makeSources({ titleChars: 120 });
  const log = [];
  const tools = {
    async web_search({ query }) {
      log.push(["search", query]);
      const content = GA.core.research.formatSearchResult(
        [{ title: "Result for " + query, url: "https://r.example/" + encodeURIComponent(query) }],
        sources,
      );
      const n = sources.add({ url: "https://r.example/" + encodeURIComponent(query) });
      return { content, sources: [{ n, title: "Result for " + query, url: sources.get(n).url }] };
    },
    async read_page({ url }) {
      log.push(["read", url]);
      const n = sources.add({ title: "Page", url });
      sources.markRead(n);
      return { content: "[" + n + "] Page\n" + url + "\n\nbody", n, title: "Page", chars: 4 };
    },
    ...over,
  };
  return { tools, sources, log };
}

const LIMITS = { maxSteps: 8, maxSearches: 5, maxPages: 3 };

async function runLoop(GA, turns, extra = {}) {
  const adapter = extra.adapter || fakeAdapter();
  const { fetchImpl, seen } = scriptedFetch(turns);
  const ft = fakeTools(GA, extra.toolsOver);
  const steps = [];
  const texts = [];
  const out = await GA.researchLoop.run({
    adapter,
    model: "m",
    key: "k",
    system: "SYS",
    userText: "question",
    tools: extra.tools || ft.tools,
    limits: extra.limits || LIMITS,
    signal: extra.signal,
    onText: (t) => texts.push(t),
    onStep: (s) => steps.push(s),
    onCheckpoint: extra.onCheckpoint,
    sources: ft.sources,
    fetchImpl,
    now: extra.now,
  });
  return { out, steps, texts, adapter, seen, log: ft.log };
}

describe("researchLoop.run", () => {
  it("text-only turn: streams, answers, no Sources footer", async () => {
    const GA = load();
    const r = await runLoop(GA, [[text("Hello "), text("world")]]);
    expect(r.out).toEqual({ text: "Hello world", sources: [], steps: 1, searches: 0, pages: 0 });
    expect(r.texts).toEqual(["Hello ", "Hello world", "Hello world"]);
    expect(r.steps).toEqual([
      { kind: "step", step: 1, maxSteps: 8 },
      { kind: "final", step: 1 },
    ]);
    const req = r.adapter.requests[0];
    expect(req).toMatchObject({
      model: "m",
      key: "k",
      system: "SYS",
      toolChoice: "auto",
      tools: ["web_search", "read_page"],
    });
    expect(r.seen[0].init.method).toBe("POST");
    expect(r.seen[0].init.headers).toEqual({ k: "k" });
  });

  it("search then final: steps in order, cited flags, Sources footer", async () => {
    const GA = load();
    const r = await runLoop(GA, [
      [call("c1", "web_search", { query: "tides" })],
      [text("Tides are lunar [1].")],
    ]);
    expect(r.steps.map((s) => s.kind)).toEqual(["step", "search", "results", "step", "final"]);
    expect(r.steps[2]).toEqual({
      kind: "results",
      step: 1,
      query: "tides",
      count: 1,
      sources: [{ n: 1, title: "Result for tides", url: "https://r.example/tides" }],
    });
    expect(r.out.text).toBe(
      "Tides are lunar [1].\n\n---\nSources\n[1] Result for tides — https://r.example/tides",
    );
    expect(r.texts[r.texts.length - 1]).toBe(r.out.text);
    expect(r.out.sources).toEqual([
      { n: 1, title: "Result for tides", url: "https://r.example/tides", read: false, cited: true },
    ]);
    expect(r.out).toMatchObject({ steps: 2, searches: 1, pages: 0 });
    // the tool result went back in call order with the id
    const convo = r.adapter.requests[1].convo;
    expect(convo[1].calls[0]).toMatchObject({ id: "c1", name: "web_search" });
    expect(convo[2].results).toEqual([
      {
        id: "c1",
        name: "web_search",
        content: "[1] Result for tides\nhttps://r.example/tides",
        isError: false,
      },
    ]);
  });

  it("read then final: read / read-done steps, uncited read page still listed", async () => {
    const GA = load();
    const r = await runLoop(GA, [
      [call("c1", "read_page", { url: "https://p.example/a" })],
      [text("Answer without ids.")],
    ]);
    expect(r.steps.slice(1, 3)).toEqual([
      { kind: "read", step: 1, url: "https://p.example/a" },
      { kind: "read-done", step: 1, n: 1, title: "Page", chars: 4 },
    ]);
    expect(r.out.text).toBe("Answer without ids.\n\n---\nSources\n[1] Page — https://p.example/a");
    expect(r.out.sources[0]).toMatchObject({ n: 1, read: true, cited: false });
    expect(r.out.pages).toBe(1);
  });

  it("forces a tools-off final turn at maxSteps", async () => {
    const GA = load();
    const r = await runLoop(
      GA,
      [
        [call("c1", "web_search", { query: "a" })],
        // the model tries another call anyway: ignored, its text is the answer
        [text("Final."), call("c2", "web_search", { query: "b" })],
      ],
      { limits: { maxSteps: 2, maxSearches: 5, maxPages: 3 } },
    );
    expect(r.adapter.requests.map((q) => q.toolChoice)).toEqual(["auto", "none"]);
    expect(r.adapter.requests[1].tools).toEqual(["web_search", "read_page"]);
    const convo = r.adapter.requests[1].convo;
    expect(convo[convo.length - 1]).toEqual({ user: GA.researchLoop.FINAL_NUDGE });
    expect(r.log).toEqual([["search", "a"]]);
    expect(r.out.text).toBe("Final.");
    expect(r.steps[r.steps.length - 1]).toEqual({ kind: "final", step: 2 });
  });

  it("forces the final turn once the run deadline passes", async () => {
    const GA = load();
    let t = 0;
    const r = await runLoop(
      GA,
      [[call("c1", "web_search", { query: "a" })], [text("Late answer.")]],
      {
        now: () => {
          const v = t;
          t += GA.config.RESEARCH_RUN_TIMEOUT_MS; // each check jumps a whole run
          return v;
        },
      },
    );
    expect(r.adapter.requests.map((q) => q.toolChoice)).toEqual(["auto", "none"]);
    expect(r.out.text).toBe("Late answer.");
  });

  it("serves a repeated query from the cache without spending budget", async () => {
    const GA = load();
    const r = await runLoop(
      GA,
      [
        [call("c1", "web_search", { query: "Tides" })],
        [call("c2", "web_search", { query: "  tides " })],
        [text("done [1]")],
      ],
      { limits: { maxSteps: 8, maxSearches: 1, maxPages: 3 } },
    );
    expect(r.log).toEqual([["search", "Tides"]]);
    expect(r.out.searches).toBe(1);
    expect(r.steps.filter((s) => s.kind === "tool-error")).toEqual([]);
    expect(r.steps.filter((s) => s.kind === "results")).toHaveLength(2);
  });

  it("budget exhaustion is a tool error and the run continues", async () => {
    const GA = load();
    const r = await runLoop(
      GA,
      [
        [call("c1", "web_search", { query: "a" }), call("c2", "web_search", { query: "b" })],
        [call("c3", "read_page", { url: "https://p.example/" })],
        [text("ok")],
      ],
      { limits: { maxSteps: 8, maxSearches: 1, maxPages: 1 } },
    );
    const errs = r.steps.filter((s) => s.kind === "tool-error");
    expect(errs).toEqual([
      {
        kind: "tool-error",
        step: 1,
        tool: "web_search",
        message: "Search budget exhausted; answer from what you have.",
      },
    ]);
    const results = r.adapter.requests[1].convo[2].results;
    expect(results.map((x) => x.isError)).toEqual([false, true]);
    expect(r.out).toMatchObject({ searches: 1, pages: 1 });
  });

  it("page budget exhaustion is a tool error too", async () => {
    const GA = load();
    const r = await runLoop(
      GA,
      [
        [
          call("c1", "read_page", { url: "https://p.example/1" }),
          call("c2", "read_page", { url: "https://p.example/2" }),
        ],
        [text("ok")],
      ],
      { limits: { maxSteps: 8, maxSearches: 5, maxPages: 1 } },
    );
    expect(r.log).toEqual([["read", "https://p.example/1"]]);
    expect(r.steps.find((s) => s.kind === "tool-error").message).toBe(
      "Page budget exhausted; answer from what you have.",
    );
  });

  it("a failing tool becomes a tool error; the model still answers", async () => {
    const GA = load();
    const r = await runLoop(
      GA,
      [[call("c1", "web_search", { query: "a" })], [text("From memory (unverified).")]],
      {
        toolsOver: {
          web_search: async () => {
            throw new Error("DuckDuckGo blocked the request");
          },
        },
      },
    );
    expect(r.steps).toContainEqual({
      kind: "tool-error",
      step: 1,
      tool: "web_search",
      message: "DuckDuckGo blocked the request",
    });
    expect(r.adapter.requests[1].convo[2].results[0]).toEqual({
      id: "c1",
      name: "web_search",
      content: "DuckDuckGo blocked the request",
      isError: true,
    });
    expect(r.out.text).toBe("From memory (unverified).");
    expect(r.out.searches).toBe(0);
  });

  it("unknown tools and tools not offered are tool errors", async () => {
    const GA = load();
    const r = await runLoop(
      GA,
      [[call("c1", "delete_everything", {}), call("c2", "read_page", { url: "x" })], [text("ok")]],
      { limits: { maxSteps: 8, maxSearches: 5, maxPages: 0 } },
    );
    expect(r.adapter.requests[0].tools).toEqual(["web_search"]);
    expect(r.steps.filter((s) => s.kind === "tool-error").map((s) => s.message)).toEqual([
      "Unknown tool: delete_everything",
      "Unknown tool: read_page",
    ]);
    expect(r.log).toEqual([]);
  });

  it("drops a tool the caller did not provide", async () => {
    const GA = load();
    const { tools } = fakeTools(GA);
    const r = await runLoop(GA, [[text("x")]], { tools: { web_search: tools.web_search } });
    expect(r.adapter.requests[0].tools).toEqual(["web_search"]);
  });

  it("unparseable arguments are a tool error", async () => {
    const GA = load();
    const r = await runLoop(GA, [[call("c1", "web_search", null)], [text("ok")]]);
    expect(r.steps.find((s) => s.kind === "tool-error")).toEqual({
      kind: "tool-error",
      step: 1,
      tool: "web_search",
      message: "arguments were not valid JSON",
    });
    expect(r.log).toEqual([]);
  });

  it("preamble text before a tool call is retracted (reset) and kept as a note", async () => {
    const GA = load();
    const r = await runLoop(GA, [
      [text("Let me look "), text("that up."), call("c1", "web_search", { query: "a" })],
      [text("Answer.")],
    ]);
    expect(r.texts).toEqual(["Let me look ", "Let me look that up.", "", "Answer.", "Answer."]);
    expect(r.steps.slice(0, 3)).toEqual([
      { kind: "step", step: 1, maxSteps: 8 },
      { kind: "note", step: 1, text: "Let me look that up." },
      { kind: "search", step: 1, query: "a" },
    ]);
  });

  it("no reset/note when the tool call comes first", async () => {
    const GA = load();
    const r = await runLoop(GA, [[call("c1", "web_search", { query: "a" })], [text("A.")]]);
    expect(r.texts).not.toContain("");
    expect(r.steps.some((s) => s.kind === "note")).toBe(false);
  });

  it("calls onCheckpoint after each tool round", async () => {
    const GA = load();
    const states = [];
    await runLoop(GA, [[call("c1", "web_search", { query: "a" })], [text("A.")]], {
      onCheckpoint: (s) => states.push({ step: s.step, searches: s.searches }),
    });
    expect(states).toEqual([{ step: 1, searches: 1 }]);
  });

  it("abort mid-run (inside a tool) rethrows AbortError", async () => {
    const GA = load();
    const ac = new AbortController();
    const err = await runLoop(GA, [[call("c1", "web_search", { query: "a" })], [text("never")]], {
      signal: ac.signal,
      toolsOver: {
        web_search: async () => {
          ac.abort();
          const e = new Error("aborted");
          e.name = "AbortError";
          throw e;
        },
      },
    }).catch((e) => e);
    expect(err.name).toBe("AbortError");
  });

  it("an already-aborted signal stops before the first request", async () => {
    const GA = load();
    const ac = new AbortController();
    ac.abort();
    const err = await runLoop(GA, [[text("never")]], { signal: ac.signal }).catch((e) => e);
    expect(err.name).toBe("AbortError");
  });

  it("aborting during the model stream maps to AbortError", async () => {
    const GA = load();
    const ac = new AbortController();
    const hang = (init) => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () =>
            new Promise((_, reject) => {
              init.signal.addEventListener("abort", () => {
                const e = new Error("aborted");
                e.name = "AbortError";
                reject(e);
              });
              ac.abort();
            }),
        }),
      },
    });
    const err = await runLoop(GA, [hang], { signal: ac.signal }).catch((e) => e);
    expect(err.name).toBe("AbortError");
  });

  it("an HTTP error from the provider ends the run", async () => {
    const GA = load();
    const bad = () => ({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ error: { message: "model has no tools" } })),
    });
    await expect(runLoop(GA, [bad])).rejects.toThrow(
      "Fake API error (HTTP 400): model has no tools",
    );
  });

  it("a provider error event ends the run", async () => {
    const GA = load();
    await expect(runLoop(GA, [[text("x"), { error: "overloaded" }]])).rejects.toThrow("overloaded");
  });

  it("an empty final answer is an error", async () => {
    const GA = load();
    await expect(runLoop(GA, [[]])).rejects.toThrow("Fake returned an empty answer.");
  });
});
