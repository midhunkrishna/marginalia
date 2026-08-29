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

  async function ask(req, onChunk) {
    const payload = GA.gemini.payload;
    const parser = GA.gemini.parser;
    const tokens = (req && req.tokens) || {};
    if (!tokens.at) throw new Error("Missing session token (SNlM0e). Are you logged in to Gemini?");

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
        body: payload.buildBody(req.prompt, tokens.at, (req && req.ids) || undefined),
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
      // The cursor also captures the conversation triplet (c_/r_/rc_) so the
      // caller can reuse the hidden side-conversation on the next follow-up
      // instead of spawning a new Gemini sidebar conversation per ask (gh #18).
      const stream = parser.makeStream();
      const text = await GA.streamText(res, stream, onChunk, parseFailMsg(), budget);
      const ids = stream.ids();
      if (ids && ids[0] && ids[1]) return { text, ids };
      return text;
    } catch (e) {
      throw GA.mapBudgetError(e, budget, timeoutMsg);
    } finally {
      budget.clear();
    }
  }

  return { ask };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.geminiWebClient;
