// ask-service.js — Facade over the background "ask" port. Callers get
// `ask({provider, prompt, tokens}, onChunk) -> { result, stop, abort }` and
// never see the runtime port or the message protocol. The background routes to
// the right backend client by `provider` (see background/clients.js).
//
// Cancellation is "disconnect-is-abort": closing the port makes the background
// abort the in-flight fetch (see background.js). Two flavors:
//   stop()  — user pressed Stop: resolve `result` with the accumulated partial
//             text so the turn finalizes normally and keeps what streamed in.
//   abort() — teardown (conversation switch, thread deleted): reject `result`
//             with an AbortError so the turn skips error rendering.
// A watchdog rejects if the port goes silent (no chunks, no heartbeat pings)
// for ASK_WATCHDOG_MS — that's a dead service worker, not a slow reply.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.askService = (function () {
  const P = GA.protocol;

  function ask(request, onChunk) {
    let resolveP;
    let rejectP;
    const result = new Promise(function (res, rej) {
      resolveP = res;
      rejectP = rej;
    });

    const port = browser.runtime.connect({ name: P.PORT_ASK });
    let finalText = "";
    let finalIds = null;
    let settled = false;
    let watchdog = null;

    function finish(ok, value) {
      if (settled) return;
      settled = true;
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
      if (ok) resolveP(value);
      else rejectP(value);
    }

    function disconnect() {
      try {
        port.disconnect();
      } catch (e) {}
    }

    function bumpWatchdog() {
      if (settled) return;
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(
        function () {
          finish(false, new Error("No response from the extension — try again."));
          disconnect();
        },
        (GA.config && GA.config.ASK_WATCHDOG_MS) || 90000,
      );
    }

    port.onMessage.addListener(function (msg) {
      if (!msg) return;
      bumpWatchdog(); // any frame (chunk/ping/…) proves the worker is alive
      if (msg.type === P.MSG_CHUNK) {
        // Delta protocol (shared/stream-delta.js): append, or reset to a full
        // rewrite. Plain `text` (no reset) kept for protocol back-compat.
        if (typeof msg.delta === "string") finalText += msg.delta;
        else finalText = msg.text || "";
        if (onChunk) onChunk(finalText);
      } else if (msg.type === P.MSG_DONE) {
        if (Array.isArray(msg.ids)) finalIds = msg.ids;
        const text = msg.text || finalText;
        finish(true, finalIds && finalIds[0] && finalIds[1] ? { text, ids: finalIds } : text);
        disconnect();
      } else if (msg.type === P.MSG_ERROR) {
        const err = new Error(msg.message || "Request failed");
        if (msg.code) err.code = msg.code;
        finish(false, err);
        disconnect();
      }
    });

    // Fires only when the OTHER side goes away (a port doesn't see its own
    // disconnect()) — i.e. the background died mid-ask.
    port.onDisconnect.addListener(function () {
      finish(false, new Error("Connection to extension closed."));
    });

    bumpWatchdog();
    port.postMessage({
      type: P.MSG_ASK,
      provider: request.provider,
      prompt: request.prompt,
      tokens: request.tokens,
      ids: request.ids,
    });

    function stop() {
      // keep the partial answer (and any captured conversation ids)
      if (finalIds && finalIds[0] && finalIds[1]) finish(true, { text: finalText, ids: finalIds });
      else finish(true, finalText);
      disconnect(); // background aborts via its onDisconnect
    }

    function abort() {
      const e = new Error("Cancelled.");
      e.name = "AbortError";
      e.partialText = finalText;
      finish(false, e);
      disconnect();
    }

    return { result: result, stop: stop, abort: abort };
  }

  return { ask };
})();
