// client.js — WebRpcClient: the web-session strategy implementing the
// GeminiClient interface `{ ask(req, onChunk) -> Promise<string> }`.
//
// Replays gemini.google.com's internal StreamGenerate endpoint using the user's
// logged-in session (cookies attach automatically; we only pass page tokens).
// This file is now just transport + the streaming loop — the wire format lives
// in gemini/payload.js and response parsing in gemini/parser.js, both pure and
// unit-tested. A future ApiKeyClient can implement the same `ask` interface.
//
// ⚠️ REVERSE-ENGINEERED & UNDOCUMENTED. If replies stop coming through, inspect a
// live StreamGenerate request in DevTools and adjust gemini/payload.js (request)
// or gemini/parser.js (response). Everything fragile is isolated in those two.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.geminiWebClient = (function () {
  function parseFailMsg() {
    return "Couldn't parse Gemini's response — the internal API shape may have changed (see gemini/parser.js).";
  }

  // One StreamGenerate round-trip, optionally continuing `session`. Resolves
  // {text, meta} where meta is the conversation ids from the reply (or null).
  async function attempt(req, tokens, session, onChunk) {
    const payload = GA.gemini.payload;
    const parser = GA.gemini.parser;
    // Abort the request if it goes silent (see background/api-util.js) or when
    // the caller cancels via req.signal; bumped as stream bytes arrive so a
    // slow-but-live reply isn't cut off.
    const budget = GA.makeAbortBudget(GA.REQUEST_TIMEOUT_MS, req && req.signal);
    const timeoutMsg = "Gemini request timed out.";
    let res;
    try {
      res = await fetch(payload.buildUrl(tokens.bl, tokens.sid), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "X-Same-Domain": "1",
        },
        body: payload.buildBody(req.prompt, tokens.at, session),
        signal: budget.signal,
      });
    } catch (e) {
      budget.clear();
      throw GA.mapBudgetError(e, budget, timeoutMsg);
    }
    if (!res.ok) {
      budget.clear();
      const err = new Error("Gemini request failed (HTTP " + res.status + ").");
      // Expired page token (SNlM0e) — the content side invalidates its token
      // cache and retries once (see thread-controller.askThread).
      if (res.status === 401 || res.status === 403) err.code = "AUTH";
      throw err;
    }

    try {
      // Shared incremental read-loop (background/api-util.js) over the
      // frame-format cursor — only new complete lines are parsed per chunk.
      const stream = parser.makeStream();
      const text = await GA.streamText(res, stream, onChunk, parseFailMsg(), budget);
      return { text, meta: stream.meta() };
    } catch (e) {
      throw GA.mapBudgetError(e, budget, timeoutMsg);
    } finally {
      budget.clear();
    }
  }

  // Failures a fresh conversation cannot fix: an expired page token (AUTH) and
  // a caller/user cancel. Everything else may just be stale conversation ids.
  function isUnretryable(e, req) {
    const cancelled = !!(req && req.signal && req.signal.aborted);
    return cancelled || !!(e && (e.code === "AUTH" || e.name === "AbortError"));
  }

  // ask(req, onChunk) -> Promise<string>. req.session ({c, r, rc}) continues an
  // existing Gemini conversation instead of opening a new sidebar entry; the
  // ids of the conversation that answered are reported via req.onSession(meta).
  // If a request that sent ids fails (stale/deleted conversation), it is retried
  // ONCE with an empty triplet — a cluttered sidebar beats a broken ask.
  async function ask(req, onChunk) {
    const tokens = (req && req.tokens) || {};
    if (!tokens.at) throw new Error("Missing session token (SNlM0e). Are you logged in to Gemini?");

    const session = GA.gemini.payload.isValidSession(req.session) ? req.session : null;
    let out;
    try {
      out = await attempt(req, tokens, session, onChunk);
    } catch (e) {
      if (!session || isUnretryable(e, req)) throw e;
      out = await attempt(req, tokens, null, onChunk);
    }
    if (out.meta && req.onSession) req.onSession(out.meta);
    return out.text;
  }

  return { ask };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.geminiWebClient;
