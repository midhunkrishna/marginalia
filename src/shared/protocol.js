// protocol.js — the single source of truth for the message/port contract between
// the content script and the background script. Loaded by BOTH (manifest
// content_scripts AND background.scripts) so the two sides can't drift.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.protocol = {
  PORT_ASK: "ga-ask", // runtime.connect port name for streamed asks
  MSG_ASK: "ask", // content -> bg over the port: {provider, prompt, tokens?, session?, research?}
  // session: Gemini web path only — {c, r, rc} conversation ids to continue the
  // thread's existing Gemini conversation instead of opening a new sidebar chat.
  // research: true = run the multi-step research loop (background ignores
  // `provider` and uses settings.researchProvider); MSG_DONE then carries
  // research: {provider, model, steps, searches, pages, sources:[{n,title,url,read,cited}]}
  MSG_STEP: "research-step", // bg -> content: live research progress {kind, step, ...}
  // step kinds: step {step,maxSteps} · note {text} · search {query} ·
  // results {query,count,sources:[{n,title,url}]} · read {n,url} ·
  // read-done {n,title,chars} · tool-error {tool,message} · final
  MSG_CHUNK: "chunk", // bg -> content: {delta} appended text, or {reset, text} full rewrite
  MSG_DONE: "done", // bg -> content: final answer {text, research?, session?}
  // session: {c, r, rc} Gemini conversation ids the reply landed in (web path only)
  MSG_ERROR: "error", // bg -> content: failure {message, code?}
  MSG_PING: "ping", // bg -> content: heartbeat while an ask is in flight (keeps
  // Chrome's MV3 worker alive and feeds the content-side watchdog)
  MSG_OPEN_FROM_CONTEXT: "ga-open-from-context", // bg -> content (context-menu click)
  MSG_READ_TOKENS: "ga-read-tokens", // content -> bg: read WIZ_global_data in MAIN world
  MSG_OPEN_OPTIONS: "ga-open-options", // content -> bg: open the extension options page
  MSG_TEST_KEY: "ga-test-key", // options -> bg: {provider, key, model} minimal live request
  MSG_LIST_MODELS: "ga-list-models", // options -> bg: {provider, key} fetch model ids
  MSG_TEST_SEARCH: "ga-test-search", // options -> bg: {provider, key} one live search
  CONTEXT_MENU_ID: "ga-ask",
};

if (typeof module !== "undefined" && module.exports) module.exports = GA.protocol;
