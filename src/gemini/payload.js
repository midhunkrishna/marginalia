// payload.js — pure request builders for Gemini's StreamGenerate endpoint.
// No DOM, no network. Extracted from client.js so the wire format is testable.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.gemini = GA.gemini || {};

GA.gemini.payload = (function () {
  const ENDPOINT =
    "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";

  const REQID_MIN = 100000;
  const REQID_SPAN = 900000;
  const REQID_STEP = 100000; // Gemini bumps _reqid by 100000 per request
  let reqid = Math.floor(Math.random() * REQID_SPAN) + REQID_MIN;

  function buildBody(prompt, at, ids) {
    // ids = [conversationId, responseId, rcid] from a previous reply: sending
    // it reuses that hidden side-conversation instead of creating a new one per
    // follow-up (gh #18). Without ids, keep the known-good stateless shape.
    const messageStruct = [[prompt], null, ids && ids.length === 3 ? ids : [null, null, null]];
    const freq = JSON.stringify([null, JSON.stringify(messageStruct)]);
    const params = new URLSearchParams();
    params.set("f.req", freq);
    params.set("at", at);
    return params.toString();
  }

  function buildUrl(bl, sid) {
    const u = new URL(ENDPOINT);
    if (bl) u.searchParams.set("bl", bl);
    if (sid) u.searchParams.set("f.sid", sid);
    u.searchParams.set("hl", "en");
    u.searchParams.set("_reqid", String((reqid += REQID_STEP)));
    u.searchParams.set("rt", "c");
    return u.toString();
  }

  return { buildBody, buildUrl, ENDPOINT };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.gemini.payload;
