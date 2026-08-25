// modal.js — full-screen view of a single thread's conversation, with its own
// composer: you can keep asking follow-ups from the maximized view. The dialog
// lifecycle (overlay, focus trap, Esc, opener-focus restore) is the shared
// GA.dialog; this module keeps the modal-specific parts: header/body assembly,
// the edge drag-resize with session width memory, and the live-stream
// late-join. The docked box is refreshed by the controller's onClosed callback.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.Modal = (function () {
  let dlg = null; // current dialog handle — module close() targets it
  let sessionWidth = 0; // drag-resized width, remembered for this page session
  let resizer = null; // shared drag-resize handle (util.js GA.dragResize) — ends an in-flight drag on close
  let detachFeed = null; // live-stream unsubscribe (open-mid-stream case)

  // handlers: the thread's box handlers (ask/persist/onLabel/onStop) —
  // optional; the composer is omitted when `ask` is absent (read-only
  // surfaces), the label strip when handlers are absent entirely.
  // opts.draft seeds the composer (the docked box's in-progress text follows
  // the user into the modal); onClosed receives the unsent modal draft so the
  // controller can hand it back.
  function open(thread, handlers, onClosed, opts) {
    close();

    const snippet = GA.truncate(
      thread.selector && thread.selector.exact,
      GA.config.MODAL_SNIPPET_CHARS,
    );
    const title = GA.el("div", {
      class: "ga-modal-title",
      text: snippet,
      title: thread.selector && thread.selector.exact,
    });
    const closeBtn = GA.el(
      "button",
      {
        class: "ga-iconbtn ga-modal-close",
        title: "Close (Esc)",
        "aria-label": "Close",
        onclick: close,
      },
      GA.icons.make("close"),
    );
    const header = GA.el("div", { class: "ga-modal-header" }, [title, closeBtn]);

    const body = GA.el("div", { class: "ga-modal-body", role: "log", "aria-label": "Messages" });
    const empty = GA.el("div", { class: "ga-modal-empty", text: "No messages yet." });
    // Auto-scroll policy (stick-follow + the calm-scrolling hold), shared with
    // the docked box and panel via GA.CalmScroll.
    const calm = GA.CalmScroll(body);

    function appendMsg(role, text, meta) {
      empty.remove();
      const el = GA.el("div", { class: "ga-msg ga-msg-" + role });
      if (role === "model") {
        const via = GA.viaTag(meta && meta.provider);
        if (via) el.appendChild(via);
        if (meta && meta.error) {
          // No Retry in the modal (deliberate): retrying re-runs the docked
          // box's turn machinery, which the modal only mirrors.
          el.appendChild(GA.errorCard(text));
        } else {
          el.appendChild(GA.markdown.render(text));
        }
      } else if (meta && meta.md) {
        // sent with the composer's MD toggle on — same renderer as replies
        el.appendChild(GA.markdown.render(text));
      } else {
        el.textContent = text;
      }
      body.appendChild(el);
      calm.toBottom();
      return el;
    }

    (thread.messages || []).forEach((m) => appendMsg(m.role, m.text, m));
    if (!thread.messages || !thread.messages.length) body.appendChild(empty);

    // Assigned once GA.dialog.open returns below; the stream hooks and the
    // late-join closure read it lazily, so "is this modal still open?" always
    // consults THIS open's dialog, not whichever one is current. While the
    // modal is still being assembled (myDlg not set yet) it counts as live —
    // the live-stream late-join seeds its bubble before the dialog exists.
    let myDlg = null;
    const isLive = () => !myDlg || myDlg.isOpen();

    // Label strip: the same shared editor the docked box mounts, so labels
    // read and edit identically in both surfaces (same thread object — edits
    // here appear in the box via refreshMessages on close). An in-strip add
    // that converts an empty thread to a standalone label closes the modal
    // (the chip is its surface now) — but only when a composer exists; a
    // read-only label-record modal must not close itself on initial render.
    let composer = null; // assigned below; the strip's onChange reads it lazily
    let strip = null;
    if (handlers) {
      strip = GA.LabelStrip(thread, {
        persist: handlers.persist,
        onLabel: handlers.onLabel,
        isLive: isLive,
        onChange: () => {
          if (composer && thread.kind === "label") close();
        },
      });
      strip.render();
    }
    const parts = strip ? [header, strip.el, body] : [header, body];

    // Composer: same turn orchestration as the docked box. The streaming
    // machine is the shared GA.StreamView; the modal deliberately passes no
    // announce/onFinish/onEnd hooks — it has no live region, unread dot or
    // chip count, and its error cards carry no Retry.
    let streamView = null;
    if (handlers && handlers.ask) {
      streamView = GA.StreamView({
        beginEl: (meta) => {
          const el = appendMsg("model", "", meta);
          calm.answerStart();
          return el;
        },
        isLive: isLive,
        afterUpdate: () => calm.follow(),
        onEnd: () => calm.answerEnd(),
        renderFinal: (el, text) => {
          el.textContent = "";
          el.appendChild(GA.markdown.render(text));
        },
        renderError: (el, message) => {
          el.textContent = "";
          el.appendChild(GA.errorCard(message));
        },
      });
      const ops = {
        appendUser: (text, meta) => appendMsg("user", text, meta),
        beginModel: (meta) => streamView.beginModel(meta),
        renderModel: (el, text) => streamView.renderModel(el, text),
        renderError: (el, message) => streamView.renderError(el, message),
        endModel: (el) => streamView.endModel(el),
        setLoading: (v) => composer && composer.setLoading(v),
        ask: handlers.ask,
        persist: handlers.persist,
      };
      composer = GA.Composer({
        placeholder: "Ask a follow-up about the highlighted text…",
        markdownToggle: true,
        providers: GA.core.sites.askOptions(GA.provider, GA.settings),
        resizable: true, // the maximized view has room — let the input grow
        onSubmit: (q, sendOpts) => {
          // Same shared /label intercept as the docked box; the strip
          // updating is the feedback (parity with the box). Converting an
          // empty thread closes the modal (the chip is its surface now) —
          // the controller's conversion toast explains why.
          const handled = GA.tryLabelCommand(q, thread, handlers, () => {
            if (thread.kind === "label") close();
            else if (strip) strip.render();
          });
          if (handled) return;
          GA.threadTurn.run(thread, q, ops, sendOpts);
        },
        onStop: () => handlers.onStop && handlers.onStop(thread),
      });
      if (opts && opts.draft) composer.setDraft(opts.draft);
      parts.push(composer.el);

      // Late-join an answer already streaming in the docked box (controller's
      // live-stream registry): seed a bubble with the text so far, follow the
      // feed, and finalize once the box's turn settles. Stop needs no special
      // casing — onStop targets the thread's in-flight ask by id, whichever
      // surface started it.
      const feed = handlers.liveStream ? handlers.liveStream(thread.id) : null;
      if (feed) {
        const el = ops.beginModel();
        ops.setLoading(true);
        ops.renderModel(el, feed.text);
        const onFeed = (text, done) => {
          ops.renderModel(el, text);
          if (!done) return;
          detachFeed = null;
          // The box's threadTurn pushes the settled message (final / stopped /
          // error) only after the feed ends — defer one tick so we can read it.
          setTimeout(() => {
            if (!isLive()) return;
            const msgs = thread.messages || [];
            const last = msgs[msgs.length - 1];
            if (last && last.role === "model" && last.error) ops.renderError(el, last.text);
            ops.endModel(el);
            ops.setLoading(false);
          }, 0);
        };
        feed.subscribe(onFeed);
        detachFeed = () => feed.unsubscribe(onFeed);
      }
    }

    const panel = GA.el("div", { class: "ga-modal" }, parts);
    if (sessionWidth) panel.style.width = sessionWidth + "px";
    myDlg = dlg = GA.dialog.open({
      label: "Comment thread: " + snippet,
      content: panel,
      initialFocus: composer ? composer.textarea : closeBtn,
      onClose: function () {
        if (resizer) resizer.end();
        if (detachFeed) {
          detachFeed();
          detachFeed = null;
        }
        if (streamView) streamView.cancel();
        if (dlg === myDlg) dlg = null;
        // Unsent text goes back to the caller — never dies with the dialog.
        if (onClosed) onClosed(composer ? composer.draft() : "");
      },
    });
    resizer = attachResize(panel, myDlg.overlay);
  }

  // Width-only drag resize (see util.js GA.dragResize for the 2*dx rationale);
  // the dragged width is remembered for the rest of the page session.
  function attachResize(panel, overlay) {
    return GA.dragResize(panel, overlay, {
      width: {
        min: GA.config.MODAL_MIN_PX,
        maxFrac: GA.config.MODAL_MAX_FRAC,
        fallback: GA.config.MODAL_FALLBACK_PX,
      },
      onEnd: function (s) {
        sessionWidth = s.w || sessionWidth;
      },
    });
  }

  function close() {
    if (dlg) dlg.close();
  }

  return { open, close };
})();
