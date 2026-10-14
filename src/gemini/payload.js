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

  // A string id longer than, and starting with, the expected prefix.
  function isIdWith(v, prefix) {
    return typeof v === "string" && v.length > prefix.length && v.indexOf(prefix) === 0;
  }

  // True when `session` is {c, r, rc} with all three ids carrying their
  // expected prefixes (c_… / r_… / rc_…) — the only shape safe to send.
  function isValidSession(session) {
    return (
      !!session &&
      isIdWith(session.c, "c_") &&
      isIdWith(session.r, "r_") &&
      isIdWith(session.rc, "rc_")
    );
  }

  // The conversation triplet: [c, r, rc] to continue an existing Gemini chat,
  // or all nulls to start a new one (also the fallback for a malformed session).
  function conversationTriplet(session) {
    return isValidSession(session) ? [session.c, session.r, session.rc] : [null, null, null];
  }

  // `session` ({c, r, rc}, optional) continues that conversation; without it a
  // new one starts. The full thread context is baked into `prompt` by the caller
  // either way (the thread may hold other providers' answers Gemini never saw).
  function buildBody(prompt, at, session) {
    const messageStruct = [[prompt], null, conversationTriplet(session)];
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

  return { buildBody, buildUrl, isValidSession, ENDPOINT };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.gemini.payload;
