import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// MSG_TEST_KEY / MSG_LIST_MODELS (issue #2): key-test.js registers its own
// one-shot onMessage listener, gated to options-page senders, and always
// RESOLVES plain {ok, ...} objects (Errors don't cross sendMessage).

function jsonRes(status, obj) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(obj)),
    json: () => Promise.resolve(obj),
  };
}

function loadKeyTest(fetchImpl) {
  const onMessage = [];
  const browser = {
    runtime: {
      id: "ext-id",
      getURL: (p) => "moz-extension://abc/" + p,
      onMessage: {
        addListener(fn) {
          onMessage.push(fn);
        },
      },
    },
  };
  const GA = loadGA(
    [
      "src/shared/protocol.js",
      "src/background/api-util.js",
      "src/openai/payload.js",
      "src/googleai/payload.js",
      "src/anthropic/payload.js",
      "src/openrouter/payload.js",
      "src/core/html-text.js",
      "src/search/brave.js",
      "src/search/ddg.js",
      "src/search/engines.js",
      "src/background/key-test.js",
    ],
    { browser, fetch: fetchImpl },
  );
  const dispatch = (msg, sender) => onMessage.map((fn) => fn(msg, sender));
  return { GA, dispatch };
}

const OPTIONS_SENDER = { id: "ext-id", url: "moz-extension://abc/src/options/options.html" };
const CONTENT_SENDER = { id: "ext-id", tab: { id: 7, url: "https://claude.ai/chat/abc" } };

describe("background key-test handlers", () => {
  it("testKey resolves ok with round-trip ms on HTTP 200", async () => {
    let seen;
    const { GA } = loadKeyTest((url, init) => {
      seen = { url, init };
      return Promise.resolve(jsonRes(200, { choices: [] }));
    });
    const r = await GA.keyTest.testKey({ provider: "openai", key: "sk-t", model: "gpt-4o-mini" });
    expect(r.ok).toBe(true);
    expect(r.model).toBe("gpt-4o-mini");
    expect(typeof r.ms).toBe("number");
    expect(seen.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(seen.init.method).toBe("POST");
    expect(seen.init.headers.Authorization).toBe("Bearer sk-t");
  });

  it("testKey surfaces status + provider detail on HTTP 401", async () => {
    const { GA } = loadKeyTest(() =>
      Promise.resolve(jsonRes(401, { error: { message: "Incorrect API key provided" } })),
    );
    const r = await GA.keyTest.testKey({ provider: "openai", key: "sk-bad", model: "m" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.detail).toBe("Incorrect API key provided");
    expect(r.message).toContain("OpenAI API error (HTTP 401)");
  });

  it("testKey maps a fetch rejection to status 0 network error", async () => {
    const { GA } = loadKeyTest(() => Promise.reject(new TypeError("Failed to fetch")));
    const r = await GA.keyTest.testKey({ provider: "gemini", key: "k", model: "m" });
    expect(r).toMatchObject({ ok: false, status: 0, message: "Network error." });
  });

  it("testKey rejects an unknown provider without fetching", async () => {
    let called = 0;
    const { GA } = loadKeyTest(() => {
      called++;
      return Promise.resolve(jsonRes(200, {}));
    });
    const r = await GA.keyTest.testKey({ provider: "chatgpt", key: "k", model: "m" });
    expect(r.ok).toBe(false);
    expect(called).toBe(0);
  });

  it("listModels resolves filtered, sorted models on success", async () => {
    const { GA } = loadKeyTest((url, init) => {
      expect(init.method).toBe("GET");
      expect(init.body).toBeUndefined();
      return Promise.resolve(
        jsonRes(200, {
          data: [
            { id: "whisper-1", created: 900 },
            { id: "gpt-4o-mini", created: 100 },
            { id: "gpt-4o", created: 300 },
          ],
        }),
      );
    });
    const r = await GA.keyTest.listModels({ provider: "openai", key: "sk-t" });
    expect(r.ok).toBe(true);
    expect(r.models.map((m) => m.id)).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  it("listModels reports {ok:false} on HTTP error and on malformed JSON", async () => {
    const err = await loadKeyTest(() =>
      Promise.resolve(jsonRes(401, { error: { message: "bad key" } })),
    ).GA.keyTest.listModels({ provider: "anthropic", key: "k" });
    expect(err).toMatchObject({ ok: false, status: 401 });

    const bad = await loadKeyTest(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("not json {{{") }),
    ).GA.keyTest.listModels({ provider: "anthropic", key: "k" });
    expect(bad.ok).toBe(false);
  });

  it("a body read aborted by the budget maps to 'Test timed out.' (headers-then-stall)", async () => {
    const abortErr = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    const { GA } = loadKeyTest(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.reject(abortErr) }),
    );
    const r = await GA.keyTest.testKey({ provider: "openai", key: "k", model: "m" });
    expect(r).toMatchObject({ ok: false, status: 0, message: "Test timed out." });
  });

  it("listener answers only its two types from the options page, undefined otherwise", async () => {
    const { GA, dispatch } = loadKeyTest(() => Promise.resolve(jsonRes(200, { data: [] })));
    const test = { type: GA.protocol.MSG_TEST_KEY, provider: "openai", key: "k", model: "m" };
    const list = { type: GA.protocol.MSG_LIST_MODELS, provider: "openai", key: "k" };

    // options-page sender: both types get a Promise back
    expect(dispatch(test, OPTIONS_SENDER)[0]).toBeInstanceOf(Promise);
    expect(dispatch(list, OPTIONS_SENDER)[0]).toBeInstanceOf(Promise);

    // content-script sender, other types, null: undefined (no hijack)
    expect(dispatch(test, CONTENT_SENDER)[0]).toBeUndefined();
    expect(dispatch({ type: "ask" }, OPTIONS_SENDER)[0]).toBeUndefined();
    expect(dispatch(null, OPTIONS_SENDER)[0]).toBeUndefined();
  });

  it("testKey drives OpenRouter with max_tokens and attribution headers", async () => {
    let seen;
    const { GA } = loadKeyTest((url, init) => {
      seen = { url, init };
      return Promise.resolve(jsonRes(200, { choices: [] }));
    });
    const r = await GA.keyTest.testKey({ provider: "openrouter", key: "or-k", model: "a/b" });
    expect(r).toMatchObject({ ok: true, model: "a/b" });
    expect(seen.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(seen.init.headers).toMatchObject({
      Authorization: "Bearer or-k",
      "X-Title": "Marginalia",
    });
    expect(JSON.parse(seen.init.body)).toMatchObject({ model: "a/b", max_tokens: 1 });
  });

  it("listModels for OpenRouter keeps every id and flags tool support", async () => {
    let seenUrl;
    const { GA } = loadKeyTest((url) => {
      seenUrl = url;
      return Promise.resolve(
        jsonRes(200, {
          data: [
            { id: "x/old", created: 1, supported_parameters: ["tools"] },
            { id: "y/new", created: 2, supported_parameters: ["temperature"] },
          ],
        }),
      );
    });
    const r = await GA.keyTest.listModels({ provider: "openrouter", key: "or-k" });
    expect(seenUrl).toBe("https://openrouter.ai/api/v1/models");
    expect(r).toEqual({
      ok: true,
      models: [
        { id: "y/new", created: 2, tools: false },
        { id: "x/old", created: 1, tools: true },
      ],
    });
  });
});

describe("background search test (MSG_TEST_SEARCH)", () => {
  const textRes = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  });
  const BRAVE_BODY = JSON.stringify({
    web: {
      results: [
        { title: "A", url: "https://a.example/", description: "a" },
        { title: "B", url: "https://b.example/", description: "b" },
      ],
    },
  });

  it("brave: one keyed GET with a 3-result query, resolves the count", async () => {
    let seen;
    const { GA } = loadKeyTest((url, init) => {
      seen = { url, init };
      return Promise.resolve(textRes(200, BRAVE_BODY));
    });
    const r = await GA.keyTest.testSearch({ provider: "brave", key: " bk " });
    expect(r).toMatchObject({ ok: true, count: 2 });
    expect(typeof r.ms).toBe("number");
    expect(seen.url).toBe(
      "https://api.search.brave.com/res/v1/web/search?q=marginalia%20extension&count=3",
    );
    expect(seen.init.method).toBe("GET");
    expect(seen.init.headers["X-Subscription-Token"]).toBe("bk");
  });

  it("brave without a key fails before fetching", async () => {
    let fetched = false;
    const { GA } = loadKeyTest(() => {
      fetched = true;
      return Promise.resolve(textRes(200, BRAVE_BODY));
    });
    const r = await GA.keyTest.testSearch({ provider: "brave", key: "" });
    expect(r).toMatchObject({ ok: false, message: "Enter a Brave API key first." });
    expect(fetched).toBe(false);
  });

  it("brave HTTP error surfaces the API message", async () => {
    const { GA } = loadKeyTest(() =>
      Promise.resolve(textRes(401, JSON.stringify({ error: { message: "bad token" } }))),
    );
    const r = await GA.keyTest.testSearch({ provider: "brave", key: "bk" });
    expect(r).toMatchObject({
      ok: false,
      status: 401,
      message: "Brave Search API error (HTTP 401): bad token",
    });
  });

  it("ddg: keyless, and a challenge page is reported as blocked", async () => {
    const { GA } = loadKeyTest(() =>
      Promise.resolve(textRes(200, "<html><form id='challenge-form'></form></html>")),
    );
    const r = await GA.keyTest.testSearch({ provider: "ddg" });
    expect(r).toMatchObject({
      ok: false,
      message: "DuckDuckGo blocked the request — try again later or add a Brave key.",
    });
  });

  it("ddg: an honest page counts its results", async () => {
    const html =
      '<div class="result results_links"><a class="result__a" href="https://x.example/">X</a>' +
      '<a class="result__snippet" href="https://x.example/">snip</a></div>';
    const { GA } = loadKeyTest(() => Promise.resolve(textRes(200, html)));
    expect(await GA.keyTest.testSearch({ provider: "ddg" })).toMatchObject({ ok: true, count: 1 });
  });

  it("unknown provider and network failure resolve {ok:false}", async () => {
    const { GA } = loadKeyTest(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await GA.keyTest.testSearch({ provider: "google" })).toMatchObject({
      ok: false,
      message: "Unknown search provider.",
    });
    expect(await GA.keyTest.testSearch({ provider: "toString" })).toMatchObject({
      ok: false,
      message: "Unknown search provider.",
    });
    expect(await GA.keyTest.testSearch({ provider: "ddg" })).toMatchObject({
      ok: false,
      status: 0,
      message: "Network error.",
    });
  });

  it("is dispatched only for options-page senders", async () => {
    const { dispatch } = loadKeyTest(() => Promise.resolve(textRes(200, BRAVE_BODY)));
    const msg = { type: "ga-test-search", provider: "brave", key: "bk" };
    const p = dispatch(msg, OPTIONS_SENDER)[0];
    expect(p).toBeInstanceOf(Promise);
    expect(await p).toMatchObject({ ok: true, count: 2 });
    expect(dispatch(msg, CONTENT_SENDER)[0]).toBeUndefined();
  });
});
