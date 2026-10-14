// key-test.js — background handlers for the options page's "Test" button and
// live model dropdown (MSG_TEST_KEY / MSG_LIST_MODELS), plus the research card's
// search-engine Test (MSG_TEST_SEARCH). Network runs here, not
// in the options page, so it shares one fetch layer with the ask clients.
// Always RESOLVES plain objects ({ok, ...}) and never throws: Error objects
// don't structured-clone across runtime.sendMessage.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.keyTest = (function () {
  // Tighter than the 60s ask timeout: a Test click should fail fast.
  const TEST_TIMEOUT_MS = 15000;

  // Keyed by the options-row provider id (settings-prefix naming), NOT the
  // background registry's provider ids (chatgpt/claude) — the options page is
  // the caller and its rows are the identity here.
  const PROVIDERS = {
    openai: { label: "OpenAI", payload: () => GA.openai.payload },
    gemini: { label: "Google AI", payload: () => GA.googleai.payload },
    anthropic: { label: "Anthropic", payload: () => GA.anthropic.payload },
    openrouter: { label: "OpenRouter", payload: () => GA.openrouter.payload },
  };

  // Run one request under a single abort budget that covers BOTH the headers
  // and the full body read — a server that returns headers then stalls the body
  // must still fail within TEST_TIMEOUT_MS, or the options page's Test button
  // would hang on a never-settling sendMessage. Returns {ok, status, body}.
  // Never put the key in any thrown/returned string.
  async function timedFetch(req) {
    const budget = GA.makeAbortBudget(TEST_TIMEOUT_MS);
    try {
      const res = await fetch(req.url, {
        method: req.body != null ? "POST" : "GET",
        headers: req.headers,
        body: req.body,
        signal: budget.signal,
      });
      const body = await res.text(); // same signal: aborts with the budget
      return { ok: res.ok, status: res.status, body };
    } finally {
      budget.clear();
    }
  }

  // GA.apiErrorInfo consumes a Response-like ({status, text()}); rebuild one
  // from the already-drained body so the shared parsing/truncation applies.
  function errorInfo(label, r) {
    return GA.apiErrorInfo(label, { status: r.status, text: () => Promise.resolve(r.body) });
  }

  // -> {ok:true, model, ms} | {ok:false, status, detail, message, ms}
  // status 0 = transport failure (network down / timeout), not an HTTP error.
  async function testKey(msg) {
    const provider = PROVIDERS[msg.provider];
    if (!provider) return { ok: false, status: 0, detail: "", message: "Unknown provider.", ms: 0 };
    const started = Date.now();
    try {
      const req = provider.payload().buildTestRequest(msg.model, msg.key);
      const r = await timedFetch(req);
      const ms = Date.now() - started;
      if (!r.ok) {
        const info = await errorInfo(provider.label, r);
        return { ok: false, status: info.status, detail: info.detail, message: info.message, ms };
      }
      return { ok: true, model: msg.model, ms };
    } catch (e) {
      const ms = Date.now() - started;
      const timedOut = e && e.name === "AbortError";
      return {
        ok: false,
        status: 0,
        detail: "",
        message: timedOut ? "Test timed out." : "Network error.",
        ms,
      };
    }
  }

  // -> {ok:true, models:[{id, created}]} | {ok:false, status, message}
  async function listModels(msg) {
    const provider = PROVIDERS[msg.provider];
    if (!provider) return { ok: false, status: 0, message: "Unknown provider." };
    try {
      const payload = provider.payload();
      const r = await timedFetch(payload.buildListRequest(msg.key));
      if (!r.ok) {
        const info = await errorInfo(provider.label, r);
        return { ok: false, status: info.status, message: info.message };
      }
      const models = payload.parseModels(JSON.parse(r.body));
      return { ok: true, models };
    } catch (e) {
      return { ok: false, status: 0, message: "Model list unavailable." };
    }
  }

  // -> {ok:true, count, ms} | {ok:false, status, message, ms}
  // One real search with the research engine the options page is configuring.
  async function testSearch(msg) {
    const engines = GA.search && GA.search.engines && GA.search.engines.ENGINES;
    const engine =
      engines &&
      Object.prototype.hasOwnProperty.call(engines, msg.provider) &&
      engines[msg.provider];
    if (!engine) return { ok: false, status: 0, message: "Unknown search provider.", ms: 0 };
    const key = typeof msg.key === "string" ? msg.key.trim() : "";
    if (engine.needsKey && !key)
      return { ok: false, status: 0, message: "Enter a Brave API key first.", ms: 0 };
    const started = Date.now();
    try {
      const r = await timedFetch(engine.buildRequest("marginalia extension", key, 3));
      const ms = Date.now() - started;
      if (!r.ok) {
        const info = await errorInfo(engine.label, r);
        return { ok: false, status: info.status, message: info.message, ms };
      }
      if (engine.isBlocked && engine.isBlocked(r.body))
        return {
          ok: false,
          status: r.status,
          message: "DuckDuckGo blocked the request — try again later or add a Brave key.",
          ms,
        };
      return { ok: true, count: engine.parseResults(r.body).length, ms };
    } catch (e) {
      const ms = Date.now() - started;
      const timedOut = e && e.name === "AbortError";
      return { ok: false, status: 0, message: timedOut ? "Test timed out." : "Network error.", ms };
    }
  }

  // Sender gate for the message listener below: same extension AND an
  // options-page URL (defense in depth — the API key rides in the message).
  function fromOptionsPage(sender) {
    return !!(
      sender &&
      sender.id === browser.runtime.id &&
      typeof sender.url === "string" &&
      sender.url.indexOf(browser.runtime.getURL("src/options/")) === 0
    );
  }

  return { testKey, listModels, testSearch, fromOptionsPage, PROVIDERS, TEST_TIMEOUT_MS };
})();

// Only the options page may drive these handlers (the key rides in the
// message). A SEPARATE listener from background.js's routers; returns a
// Promise ONLY for its three message types so it never hijacks another
// handler's sendResponse channel (see the note in background.js).
if (typeof browser !== "undefined" && browser.runtime && browser.runtime.onMessage) {
  browser.runtime.onMessage.addListener(function (msg, sender) {
    if (!msg || !GA.keyTest.fromOptionsPage(sender)) return;
    if (msg.type === GA.protocol.MSG_TEST_KEY) return GA.keyTest.testKey(msg);
    if (msg.type === GA.protocol.MSG_LIST_MODELS) return GA.keyTest.listModels(msg);
    if (msg.type === GA.protocol.MSG_TEST_SEARCH) return GA.keyTest.testSearch(msg);
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = GA.keyTest;
