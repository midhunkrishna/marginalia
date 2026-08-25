// stream-view.js — the shared streaming state machine for a model reply, plus
// the error-card builder. The docked thread box and the modal both render a
// streamed answer the same way: coalesce chunk re-renders to one per animation
// frame (a fast stream otherwise flickers), apply them incrementally through
// GA.markdown.makeStreamRenderer, and finish with one clean full rebuild of
// the final text. That machine used to live as two hand-kept copies in
// thread-ui.js and modal.js; this is the single one, with the surface-specific
// behavior injected as hooks.
//
// GA.StreamView(hooks) -> { beginModel, renderModel, renderError, endModel,
//   cancel } — the four ops slot straight into a threadTurn `ops` object;
//   cancel() is for destroy paths (drop any pending frame without finalizing).
//
// hooks = {
//   beginEl(meta) -> el,        // create + attach the (empty) model message
//                               //   (meta: { provider } for a cross-model reply)
//   targetOf(el) -> node,       // where markdown streams into (default: el)
//   isLive() -> bool,           // surface still alive? gates every DOM write
//   afterUpdate(el),            // after each incremental flush (scroll/layout)
//   renderFinal(el, text),      // one-shot render of the settled final text
//   renderError(el, message),   // swap the message for an error card
//   onFinish(el, finalText)?,   // successful non-empty reply (copy action…)
//   onEnd(el)?,                 // always, error path included (chip count…)
//   announce(text)?,            // live-region announcement (omit to opt out)
// }
var GA = (typeof GA !== "undefined" && GA) || {};

GA.StreamView = function (hooks) {
  const targetOf = hooks.targetOf || ((el) => el);
  const announce = (text) => hooks.announce && hooks.announce(text);
  // One in-flight stream per view: `el` is the message the current stream
  // renders into (threadTurn passes it back to every op, but the machine's
  // frame callback needs it without an argument).
  const state = {
    el: null,
    pending: null,
    frame: 0,
    hold: 0, // trailing-flush timer while batching a long answer
    lastRenderAt: 0,
    renderer: null,
    lastText: null,
    errored: false,
  };

  function flush() {
    state.frame = 0;
    if (state.pending == null) return;
    // Adaptive cadence: short answers render every frame (the snappy start is
    // where per-frame rendering is visible AND cheap); once the answer grows
    // past SMALL, batch to one render per MAX_MS window — that is where the
    // per-flush parse cost lives. The hold timer guarantees a trailing flush,
    // so a stalled stream never leaves text unrendered.
    const smallCap = (GA.config && GA.config.STREAM_RENDER_SMALL_CHARS) || 2048;
    const windowMs = (GA.config && GA.config.STREAM_RENDER_MAX_MS) || 70;
    const now = performance.now();
    if (state.pending.length >= smallCap && now - state.lastRenderAt < windowMs) {
      if (!state.hold) {
        state.hold = setTimeout(
          function () {
            state.hold = 0;
            flush();
          },
          windowMs - (now - state.lastRenderAt),
        );
      }
      return;
    }
    if (state.hold) {
      clearTimeout(state.hold);
      state.hold = 0;
    }
    state.lastRenderAt = now;
    state.lastText = state.pending;
    state.pending = null;
    if (state.renderer && hooks.isLive() && !state.errored) {
      state.renderer.update(state.lastText);
      hooks.afterUpdate(state.el);
    }
  }

  function cancelFrame() {
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    if (state.hold) {
      clearTimeout(state.hold);
      state.hold = 0;
    }
  }

  function beginModel(meta) {
    const el = hooks.beginEl(meta);
    el.classList.add("ga-msg-streaming");
    el.setAttribute("aria-busy", "true");
    state.el = el;
    state.renderer = GA.markdown.makeStreamRenderer(targetOf(el));
    state.lastText = null;
    state.lastRenderAt = 0; // each answer starts at full render rate
    state.errored = false;
    announce("Reply started");
    return el;
  }

  function renderModel(el, text) {
    state.pending = text;
    if (!state.frame) state.frame = requestAnimationFrame(flush);
  }

  function renderError(el, message) {
    // Cancel BEFORE flagging errored: a queued flush must never race the card.
    cancelFrame();
    state.pending = null;
    state.errored = true;
    hooks.renderError(el, message);
    announce("Reply failed: " + message);
  }

  function endModel(el) {
    cancelFrame();
    // The final text may still be sitting un-flushed in `pending` — resolve it
    // before clearing so the last chunk is never dropped.
    const finalText = state.pending != null ? state.pending : state.lastText;
    state.pending = null;
    state.renderer = null;
    // One clean full rebuild so the displayed result is exactly the one-shot
    // render of the final text (skipped when an error card took over).
    if (!state.errored && finalText != null && hooks.isLive()) hooks.renderFinal(el, finalText);
    // onFinish is deliberately NOT gated on isLive(): a reply settling into a
    // destroyed box must still run its bookkeeping (the unread/copy hooks
    // guard their own DOM work).
    if (!state.errored && finalText) {
      if (hooks.onFinish) hooks.onFinish(el, finalText);
      announce("Reply finished");
    }
    el.classList.remove("ga-msg-streaming");
    el.removeAttribute("aria-busy");
    if (hooks.onEnd) hooks.onEnd(el); // error path included
  }

  // For destroy paths: drop any pending frame/text without finalizing.
  function cancel() {
    cancelFrame();
    state.pending = null;
    state.renderer = null;
  }

  return { beginModel, renderModel, renderError, endModel, cancel };
};

// Failure card shared by every surface: icon + message, plus a Retry button
// when the caller can re-run the question (the question stays in the thread,
// so retry never means retyping). Same classes both former inline copies used,
// so the existing CSS keeps working.
GA.errorCard = function (message, opts) {
  const children = [
    GA.el("span", { class: "ga-error-icon" }, GA.icons.make("alert")),
    GA.el("span", { class: "ga-error-text", text: message }),
  ];
  if (opts && opts.onRetry) {
    children.push(
      GA.el(
        "button",
        {
          class: "ga-retry-btn",
          "aria-label": "Retry question",
          onclick: function (e) {
            e.stopPropagation();
            opts.onRetry();
          },
        },
        [GA.icons.make("retry"), "Retry"],
      ),
    );
  }
  return GA.el("div", { class: "ga-error-card" }, children);
};

if (typeof module !== "undefined" && module.exports)
  module.exports = { StreamView: GA.StreamView, errorCard: GA.errorCard };
