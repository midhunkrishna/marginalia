// parser.js — pure parser for Gemini's StreamGenerate (batchexecute) responses.
// No DOM, no network: given the accumulated response text, return the answer
// string (or null). Extracted from client.js so it can be unit-tested exhaustively.
//
// The answer text grows across frames (each frame carries the full answer so
// far), while trailing frames carry only metadata — conversation/response ids
// like "c_…" / "rc_…". So we keep the LONGEST text on the precise answer path and
// only deep-search as a last resort (skipping id-like strings). This is what
// stops a metadata frame from overwriting the answer (the "flash → c_…" bug).
var GA = (typeof GA !== "undefined" && GA) || {};
GA.gemini = GA.gemini || {};

GA.gemini.parser = (function () {
  // --- StreamGenerate response shape ---
  // A decoded "wrb.fr" frame body is a positional array (Google's undocumented
  // RPC format). What each field holds:
  //   body[FIELD_CANDIDATES]                       -> [candidate, ...] answer candidates
  //   candidate[CANDIDATE_CONTENT]                 -> [answerText, ...] the reply content
  //   candidate[CANDIDATE_CONTENT][CONTENT_TEXT]   -> answerText (string)  <- what we want
  //   body[1]                                      -> [conversationId, responseId] (ids like "c_…")
  // If replies stop parsing, re-check these indices against a live request.
  const FIELD_IDS = 1; // [conversationId, responseId]
  const FIELD_CANDIDATES = 4;
  const CANDIDATE_ID = 0; // candidate[0] -> choice id ("rc_…")
  const CANDIDATE_CONTENT = 1;
  const CONTENT_TEXT = 0;

  const MAX_DEEP_DEPTH = 9; // guard against pathological nesting in the fallback
  const MIN_TEXT_LEN = 2; // shorter strings aren't answers
  const ID_HEX_MIN = 12; // a 12+ hex run is an opaque id, not prose
  const ID_NOSPACE_MIN = 20; // a 20+ char token with no spaces is an id/token

  // Pull the conversation ids out of one decoded frame body. Returns only the
  // ids this frame actually carries, each validated by prefix: {c?, r?, rc?}.
  // Metadata-only frames carry c/r without a candidate; answer frames carry rc.
  function takeIds(body) {
    const ids = {};
    try {
      const pair = body[FIELD_IDS];
      if (Array.isArray(pair)) {
        if (isIdWith(pair[0], "c_")) ids.c = pair[0];
        if (isIdWith(pair[1], "r_")) ids.r = pair[1];
      }
      const candidates = body[FIELD_CANDIDATES];
      const first = candidates && candidates[0];
      if (first && isIdWith(first[CANDIDATE_ID], "rc_")) ids.rc = first[CANDIDATE_ID];
    } catch (e) {}
    return ids;
  }

  // A string id longer than, and starting with, the expected prefix (e.g. "c_").
  function isIdWith(v, prefix) {
    return typeof v === "string" && v.length > prefix.length && v.indexOf(prefix) === 0;
  }

  // Reduce one response line into the running {best, fallback, ids} state. Shared by
  // the whole-buffer parseLatest and the incremental makeStream so the two can't
  // drift.
  function takeLine(line, state) {
    const t = line.trim();
    if (t.indexOf('[["wrb.fr"') !== 0) return;
    let outer;
    try {
      outer = JSON.parse(t);
    } catch (e) {
      return;
    }
    for (const item of outer) {
      if (!Array.isArray(item) || item[0] !== "wrb.fr" || !item[2]) continue;
      let body;
      try {
        body = JSON.parse(item[2]);
      } catch (e) {
        continue;
      }
      Object.assign(state.ids, takeIds(body));
      const precise = preciseText(body);
      if (precise != null) {
        if (state.best === null || precise.length > state.best.length) state.best = precise;
      } else if (state.fallback === null) {
        state.fallback = deepFindAnswer(body, 0);
      }
    }
  }

  function parseLatest(raw) {
    const state = { best: null, fallback: null, ids: {} }; // longest answer + last-resort + ids
    const lines = String(raw == null ? "" : raw).split("\n");
    for (const line of lines) takeLine(line, state);
    return state.best !== null ? state.best : state.fallback;
  }

  // Incremental cursor: feed decoded chunks as they arrive; only NEW complete
  // lines are parsed (parseLatest re-scans the whole buffer per chunk — O(n²)
  // over a long answer). Same output as parseLatest over the concatenated input.
  function makeStream() {
    const state = { best: null, fallback: null, ids: {} };
    let tail = "";
    function current() {
      return state.best !== null ? state.best : state.fallback;
    }
    return {
      // The conversation ids seen so far as {c, r, rc}, merged across frames
      // (later frames win), or null until all three have appeared.
      meta() {
        const { c, r, rc } = state.ids;
        return c && r && rc ? { c, r, rc } : null;
      },
      push(chunk) {
        tail += String(chunk == null ? "" : chunk);
        const lines = tail.split("\n");
        tail = lines.pop();
        for (const line of lines) takeLine(line, state);
        return current();
      },
      end() {
        if (tail) {
          takeLine(tail, state);
          tail = "";
        }
        return current();
      },
    };
  }

  // Pull the answer text from its known location in the response body.
  function preciseText(body) {
    try {
      const candidates = body[FIELD_CANDIDATES];
      const firstCandidate = candidates && candidates[0];
      const content = firstCandidate && firstCandidate[CANDIDATE_CONTENT];
      if (content && typeof content[CONTENT_TEXT] === "string") return content[CONTENT_TEXT];
    } catch (e) {}
    return null;
  }

  function deepFindAnswer(node, depth) {
    if (depth > MAX_DEEP_DEPTH) return null;
    if (typeof node === "string")
      return node.length > MIN_TEXT_LEN && !looksLikeId(node) ? node : null;
    if (Array.isArray(node)) {
      for (const c of node) {
        const r = deepFindAnswer(c, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  // conversation/response/candidate ids and opaque tokens — never the answer
  function looksLikeId(s) {
    if (/^(c|r|rc|rcdb)_/i.test(s)) return true; // c_… r_… rc_… rcdb_…
    if (new RegExp("^[0-9a-f]{" + ID_HEX_MIN + ",}$", "i").test(s)) return true; // long hex token
    if (!/\s/.test(s) && s.length >= ID_NOSPACE_MIN) return true; // long unbroken token
    return false;
  }

  // parseLatest is a test oracle: production streaming goes through makeStream
  // (gemini/client.js); specs whole-buffer-parse transcripts and hold the two
  // equivalent. preciseText / deepFindAnswer / looksLikeId are likewise
  // exported for tests only — production reaches them via takeLine.
  return { parseLatest, makeStream, takeIds, preciseText, deepFindAnswer, looksLikeId };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.gemini.parser;
