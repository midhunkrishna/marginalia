// thread-ui.js — one comment box (a single thread anchored to a highlight).
// Header has the snippet + a top-right loading spinner + minimize/expand/
// resolve/delete buttons. Supports multi-turn Q&A, Del/Backspace-to-delete
// with a Yes/No confirm, streaming model output with a Stop button, error
// cards with Retry, per-reply copy, an unread dot, and markdown rendering.
var GA = (typeof GA !== "undefined" && GA) || {};

// handlers: { ask(thread,{onChunk})->Promise<string>, persist(thread),
//             onDelete(thread), onFocus(thread), onExpand(thread),
//             onStop(thread), onResize(opts? {animate?, now?}), inRail()->bool }
// onResize opts: {animate:true} = deliberate shift, ease it; {now:true} =
// relayout synchronously in the caller's frame (stream growth must reposition
// in the same paint as the DOM write).
// inRail: is the gutter in its narrow-viewport rail mode (every box a chip)?
// Injected so the box never sniffs its ancestors for gutter classes.
GA.ThreadBox = function (thread, handlers) {
  const state = {
    loading: false,
    collapsed: false,
    resolved: false,
    active: false,
    destroyed: false,
  };

  // Message element -> its markdown body / raw text (for copy) — kept out of
  // the DOM (no expando properties).
  const bodyOf = new WeakMap();
  const textOf = new WeakMap();

  // Lazy-history state (machinery lives after appendMessage below).
  let pendingHistory = 0;
  let oldestRendered = null; // prepend point (first history message rendered)
  let idleHandle = 0;
  // Looked up at call time (not captured): jsdom lacks requestIdleCallback
  // and tests stub it per-case.
  const requestIdle = (cb) =>
    window.requestIdleCallback ? window.requestIdleCallback(cb) : setTimeout(cb, 50);
  const cancelIdle = (h) =>
    window.cancelIdleCallback ? window.cancelIdleCallback(h) : clearTimeout(h);
  const HISTORY_FLUSH_PX = 200; // near-top scroll → user is reading history

  // Streaming machine (rAF coalescing, incremental markdown, final rebuild):
  // shared with the modal via GA.StreamView. Box-scoped so destroy() can
  // cancel a pending frame. Hooks reference function declarations below —
  // safe, they only run once a turn is in flight.
  const streamView = GA.StreamView({
    beginEl: (meta) => {
      const el = appendMessage("model", "", meta);
      calm.answerStart();
      return el;
    },
    targetOf: (el) => bodyOf.get(el) || el,
    isLive: () => !state.destroyed,
    afterUpdate: () => {
      // The engine pins a bottom-heavy box's bottom edge, so growth must lift
      // the top BEFORE this frame paints — a scheduled relayout lands a frame
      // late and the box sags into the bottom gap, then jerks back up. Only
      // ask for the synchronous pass when the height actually moved (text
      // growing within a line changes nothing and the relayout reads every
      // box's anchor rect).
      const before = cachedHeights && cachedHeights.natural;
      invalidateHeight();
      if (before !== measureHeights().natural)
        handlers.onResize && handlers.onResize({ now: true });
      scrollToBottom(); // last: reads geometry the relayout may have clamped
    },
    renderFinal: (el, text) => renderModelInto(el, text),
    renderError: (el, message) => renderErrorInto(el, message),
    onFinish: (el) => {
      addCopyAction(el);
      // A reply landing in an unfocused/minimized thread gets an unread dot.
      if (!state.destroyed && (state.collapsed || !state.active)) setUnread(true);
    },
    onEnd: () => {
      updateChipCount();
      // The final one-shot rebuild can change height vs the last incremental
      // render (an unclosed fence closing, say) — close that out in this frame
      // too. onEnd deliberately still runs for destroyed boxes (bookkeeping),
      // which must not relayout for a dead box.
      if (!state.destroyed) handlers.onResize && handlers.onResize({ now: true });
      calm.answerEnd();
    },
    announce: (text) => announce(text),
  });

  // naturalHeight() is read every relayout for every box; measuring live forces
  // a reflow per box. Cache it and invalidate only when this box's content
  // actually changed (new message, stream growth, collapse, composer resize).
  let cachedHeights = null;
  function invalidateHeight() {
    cachedHeights = null;
  }
  function measureHeights() {
    if (cachedHeights == null) {
      // First measurement after attach is where lazy history materializes —
      // the engine must see the true visible-area height, never an empty box.
      ensureVisibleHistory();
      const chrome = root.offsetHeight - messagesEl.clientHeight;
      cachedHeights = { chrome, natural: chrome + messagesEl.scrollHeight };
    }
    return cachedHeights;
  }

  const snippetText = GA.truncate(
    thread.selector && thread.selector.exact,
    GA.config.SNIPPET_CHARS,
  );
  const root = GA.el("div", {
    class: "ga-box",
    tabindex: "0",
    role: "region",
    "aria-label": "Comment thread: " + snippetText,
    dataset: { gaThread: thread.id },
  });

  // Visually-hidden live region: announces reply lifecycle without re-reading
  // the streamed element (which is rebuilt too often to be a live region).
  const liveRegion = GA.el("div", { class: "ga-sr-only", "aria-live": "polite" });
  function announce(text) {
    liveRegion.textContent = "";
    liveRegion.textContent = text;
  }

  // ---- header ----
  const snippet = GA.el("div", {
    class: "ga-box-snippet",
    title: thread.selector && thread.selector.exact,
    text: snippetText,
  });
  const unreadDot = GA.el("span", { class: "ga-unread-dot", title: "New reply" });
  const chipCount = GA.el("span", { class: "ga-chip-count ga-count" });
  const spinner = GA.el("div", {
    class: "ga-spinner",
    role: "status",
    title: "Waiting for a reply…",
    "aria-label": "Waiting for a reply",
  });
  // The no-syntax door into labeling: opens the pill editor directly. /label
  // stays as the typed power-path; this button is how the feature is FOUND.
  const labelBtn = GA.el(
    "button",
    {
      class: "ga-iconbtn ga-labelbtn",
      title: "Add label",
      "aria-label": "Add label",
      onclick: function (e) {
        e.stopPropagation();
        labelStrip.edit();
      },
    },
    GA.icons.make("tag"),
  );
  const minimizeBtn = GA.el(
    "button",
    {
      class: "ga-iconbtn ga-minbtn",
      title: "Minimize",
      "aria-label": "Minimize thread",
      "aria-pressed": "false",
      onclick: function (e) {
        e.stopPropagation();
        setCollapsed(!state.collapsed);
      },
    },
    GA.icons.make("minimize"),
  );
  const expandBtn = GA.el(
    "button",
    {
      class: "ga-iconbtn",
      title: "Expand to full view",
      "aria-label": "Expand thread to full view",
      onclick: function (e) {
        e.stopPropagation();
        handlers.onExpand && handlers.onExpand(thread);
      },
    },
    GA.icons.make("expand"),
  );
  const resolveBtn = GA.el(
    "button",
    {
      class: "ga-iconbtn ga-resolvebtn",
      title: "Resolve thread",
      "aria-label": "Resolve thread",
      onclick: function (e) {
        e.stopPropagation();
        setResolved(true);
      },
    },
    GA.icons.make("resolve"),
  );
  const delBtn = GA.el(
    "button",
    {
      class: "ga-iconbtn",
      title: "Delete thread (Del)",
      "aria-label": "Delete thread",
      onclick: function (e) {
        e.stopPropagation();
        askDelete();
      },
    },
    GA.icons.make("trash"),
  );
  // Tag glyph lives in the header permanently but only shows on a labeled
  // chip (CSS: .ga-collapsed.ga-has-labels) — no icon churn on collapse.
  const labelGlyph = GA.labelGlyph({ title: "Labeled" });
  // "via Gemini" — shown once any reply in this thread came from a provider
  // other than the site's own (issue #8), so a cross-model tangent is never
  // mistaken for the site's answer. Text is the LAST such provider; the title
  // lists every one for a mixed thread.
  const viaBadge = GA.el("span", { class: "ga-tag ga-box-via", hidden: "" });
  function updateViaBadge() {
    const seen = [];
    (thread.messages || []).forEach((m) => {
      if (m.role !== "model") return;
      const label = GA.core.sites.viaLabel(m.provider, GA.provider);
      if (label && seen.indexOf(label) === -1) seen.push(label);
    });
    if (!seen.length) {
      viaBadge.hidden = true;
      viaBadge.textContent = "";
      return;
    }
    viaBadge.hidden = false;
    viaBadge.textContent = "via " + seen[seen.length - 1];
    viaBadge.title = "Answered by " + seen.join(", ");
  }
  const header = GA.el("div", { class: "ga-box-header" }, [
    unreadDot,
    labelGlyph,
    snippet,
    viaBadge,
    chipCount,
    GA.el("div", { class: "ga-box-actions" }, [
      spinner,
      labelBtn,
      minimizeBtn,
      expandBtn,
      resolveBtn,
      delBtn,
    ]),
  ]);
  // A collapsed box is a chip — clicking it (not its buttons) restores it.
  // In the narrow-viewport rail every box is a chip; there's no room to expand
  // in place, so the click opens the modal instead.
  header.addEventListener("click", function (e) {
    if (e.target.closest(".ga-iconbtn")) return;
    if (handlers.inRail && handlers.inRail()) {
      handlers.onExpand && handlers.onExpand(thread);
      return;
    }
    if (!state.collapsed) return;
    setCollapsed(false);
  });

  // ---- labels ----
  // Shown right under the header when the thread has labels (hidden while
  // collapsed — the chip's tag glyph carries the signal there). The strip
  // itself is the shared GA.LabelStrip (same one the modal mounts). Adds
  // route through the controller: on an EMPTY thread that converts the
  // record to a standalone label (destroying this box) — the isLive guard
  // skips the re-render then.
  const labelStrip = GA.LabelStrip(thread, {
    persist: (t) => handlers.persist && handlers.persist(t),
    onLabel: (t, labels) => handlers.onLabel && handlers.onLabel(t, labels),
    isLive: () => !state.destroyed,
    onChange: () => {
      root.classList.toggle("ga-has-labels", (thread.labels || []).length > 0);
      invalidateHeight();
      handlers.onResize && handlers.onResize();
    },
  });

  // ---- messages ----
  // role=log: screen readers announce additions without re-reading the whole
  // area (the streamed element itself is rebuilt too often to be a live region).
  const messagesEl = GA.el("div", { class: "ga-messages", role: "log", "aria-label": "Messages" });

  // Auto-scroll policy (stick-follow, plus the calm-scrolling hold when the
  // setting is on) — shared with the modal and panel via GA.CalmScroll.
  const calm = GA.CalmScroll(messagesEl);
  // Scrolling up near the top means the user is reading history — whatever
  // is still pending must be there (lazy fill must never truncate the past).
  messagesEl.addEventListener("scroll", function () {
    if (pendingHistory && messagesEl.scrollTop < HISTORY_FLUSH_PX) flushHistory();
  });

  // ---- composer (shared GA.Composer: Enter-to-send, Ask↔Stop swap, local
  // undo with clear-on-send snapshot) ----
  // A brand-new thread is the /label teaching moment — the command is
  // otherwise invisible. Once a conversation exists the placeholder goes
  // back to plain asking (the command still works everywhere).
  const composer = GA.Composer({
    placeholder: (thread.messages || []).length
      ? "Ask a follow-up about the highlighted text…"
      : "Ask about the highlighted text — or tag it with /label",
    ariaLabel: "Ask a follow-up about the highlighted text",
    markdownToggle: true,
    providers: GA.core.sites.askOptions(GA.provider, GA.settings),
    onSubmit: submit,
    onStop: () => handlers.onStop && handlers.onStop(thread),
    onResize: () => {
      if (state.destroyed) return;
      // Relayout measures every box — GA.Composer only fires this when the
      // textarea height actually changed.
      invalidateHeight();
      handlers.onResize && handlers.onResize();
    },
  });
  // The raw textarea keeps a local name: the Del/Backspace-to-delete guard and
  // focusInput() below key off it.
  const textarea = composer.textarea;

  // ---- resolved footer (replaces the composer while resolved) ----
  const reopenBar = GA.el("div", { class: "ga-reopen-bar" }, [
    GA.el("span", { class: "ga-reopen-note", text: "Resolved" }),
    GA.el(
      "button",
      {
        class: "ga-iconbtn ga-reopen-btn",
        title: "Reopen thread",
        "aria-label": "Reopen thread",
        onclick: function (e) {
          e.stopPropagation();
          setResolved(false);
        },
      },
      GA.icons.make("reopen"),
    ),
  ]);

  // ---- delete confirm popover (shared GA.confirmPopover) ----
  const confirm = GA.confirmPopover({
    prompt: "Delete this thread?",
    onYes: () => handlers.onDelete && handlers.onDelete(thread),
  });

  root.appendChild(liveRegion);
  root.appendChild(header);
  root.appendChild(labelStrip.el);
  root.appendChild(messagesEl);
  root.appendChild(composer.el);
  root.appendChild(reopenBar);
  root.appendChild(confirm.el);

  // Del/Backspace deletes — but only when the box (not the textarea) has focus.
  root.addEventListener("keydown", function (e) {
    if ((e.key === "Delete" || e.key === "Backspace") && document.activeElement !== textarea) {
      e.preventDefault();
      askDelete();
    } else if (e.key === "Escape") {
      hideDelete();
    }
  });
  root.addEventListener("mousedown", function () {
    handlers.onFocus && handlers.onFocus(thread);
  });
  // Hover linking: hovering the box intensifies its highlight in the page.
  root.addEventListener("mouseenter", function () {
    GA.selection.setHighlightHover(thread.id, true);
  });
  root.addEventListener("mouseleave", function () {
    GA.selection.setHighlightHover(thread.id, false);
  });

  // Restored history renders lazily (see "lazy history" above) — the
  // constructor only records how much is pending; chips never pay for it.
  pendingHistory = (thread.messages || []).length;
  updateChipCount();
  labelStrip.render();

  // restore persisted view state (don't persist — nothing changed)
  if (thread.collapsed) setCollapsed(true, { persist: false });
  if (thread.resolved) setResolved(true, { persist: false });
  if (thread.unread) setUnread(true, { persist: false });

  function updateChipCount() {
    const n = (thread.messages || []).length;
    chipCount.textContent = n ? String(n) : "";
    updateViaBadge();
  }

  // meta (optional) is the stored message record — error messages render as a
  // retry card instead of a fake model reply.
  function buildMessage(role, text, meta) {
    const el = GA.el("div", { class: "ga-msg ga-msg-" + role });
    if (role === "model") {
      const via = GA.viaTag(meta && meta.provider);
      if (via) el.appendChild(via);
      const body = GA.el("div", { class: "ga-msg-body" });
      bodyOf.set(el, body);
      el.appendChild(body);
      if (meta && meta.error) {
        renderErrorInto(el, text);
      } else {
        body.appendChild(GA.markdown.render(text));
        textOf.set(el, text);
        if (text) addCopyAction(el);
      }
    } else if (meta && meta.md) {
      // sent with the composer's MD toggle on — same renderer as replies
      el.appendChild(GA.markdown.render(text));
    } else {
      el.textContent = text;
    }
    return el;
  }

  function appendMessage(role, text, meta) {
    const el = buildMessage(role, text, meta);
    if (state.destroyed) return el; // caller keeps a handle; nothing to show
    // A live append lands below the whole history — make sure the pending
    // prefix can never end up rendered after it (belt: unreachable in
    // practice, measurement always precedes appends).
    if (pendingHistory && !oldestRendered) flushHistory();
    messagesEl.appendChild(el);
    invalidateHeight();
    updateChipCount();
    scrollToBottom(role === "user"); // sending your own message re-sticks
    return el;
  }

  // ---- lazy history ----
  // Restored history renders on demand, not in the constructor: a chip
  // (collapsed/resolved — messages hidden) builds NO message DOM until it is
  // expanded; an expanded box renders newest-first until the visible area is
  // covered, at its FIRST measurement (the box is attached and measurable by
  // then, still inside the restore task — nothing paints in between), and
  // the older remainder fills in during idle. pendingHistory counts the
  // not-yet-rendered PREFIX of thread.messages (state lives up top with the
  // other box state — it is written before this section is reached).

  function prependHistoryMessage(m) {
    const el = buildMessage(m.role, m.text, m);
    messagesEl.insertBefore(el, oldestRendered); // null -> append (after pin)
    oldestRendered = el;
  }

  function ensureVisibleHistory() {
    if (!pendingHistory || state.collapsed || state.resolved || !root.isConnected) return;
    // Newest-first until one viewport is covered — an upper bound of any
    // messages cap the engine can apply, so the visible clamped area paints
    // exactly as an eager render would. Small threads render fully here.
    const target = window.innerHeight;
    const msgs = thread.messages || [];
    while (pendingHistory > 0 && messagesEl.scrollHeight < target) {
      prependHistoryMessage(msgs[pendingHistory - 1]);
      pendingHistory--;
    }
    calm.toBottom();
    if (pendingHistory > 0) scheduleIdleFill();
  }

  function scheduleIdleFill() {
    if (idleHandle) return;
    idleHandle = requestIdle(function () {
      idleHandle = 0;
      if (!pendingHistory || state.destroyed) return;
      const msgs = thread.messages || [];
      const before = messagesEl.scrollHeight;
      for (let i = 0; i < 4 && pendingHistory > 0; i++) {
        prependHistoryMessage(msgs[pendingHistory - 1]);
        pendingHistory--;
      }
      // Content grew ABOVE the fold — keep what's on screen where it is
      // (explicit: scroll anchoring on prepends isn't reliable cross-engine).
      messagesEl.scrollTop += messagesEl.scrollHeight - before;
      if (pendingHistory) scheduleIdleFill();
      else {
        // Fill complete: heights may now exceed the engine's cap assumption
        // only in ways the clamp already absorbs, but let the cache learn the
        // final truth once.
        invalidateHeight();
        handlers.onResize && handlers.onResize();
      }
    });
  }

  // Sync-render everything still pending. Triggers: expand/uncollapse (the
  // chip promised full history), a near-top scroll (the user is reading
  // history — an incomplete top would silently truncate it), and the
  // belt-guard in appendMessage.
  function flushHistory() {
    if (!pendingHistory) return;
    if (idleHandle) {
      cancelIdle(idleHandle);
      idleHandle = 0;
    }
    const msgs = thread.messages || [];
    const before = messagesEl.scrollHeight;
    while (pendingHistory > 0) {
      prependHistoryMessage(msgs[pendingHistory - 1]);
      pendingHistory--;
    }
    messagesEl.scrollTop += messagesEl.scrollHeight - before;
    invalidateHeight();
  }

  function renderModelInto(el, text) {
    if (state.destroyed) return;
    const body = bodyOf.get(el) || el;
    body.textContent = "";
    body.appendChild(GA.markdown.render(text));
    textOf.set(el, text);
    invalidateHeight();
    scrollToBottom();
  }

  // Failure card: message + Retry (the question stays in the thread, so retry
  // never means retyping). Card DOM comes from the shared GA.errorCard.
  function renderErrorInto(el, message) {
    if (state.destroyed) return;
    const body = bodyOf.get(el) || el;
    body.textContent = "";
    body.appendChild(GA.errorCard(message, { onRetry: () => retryTurn(el) }));
    invalidateHeight();
    scrollToBottom();
  }

  // Hover-revealed copy button on a finished model reply (copies raw markdown).
  function addCopyAction(el) {
    if (el.querySelector(".ga-msg-actions")) return;
    const copyBtn = GA.el(
      "button",
      {
        class: "ga-iconbtn ga-msg-copy",
        title: "Copy reply",
        "aria-label": "Copy reply",
        onclick: function (e) {
          e.stopPropagation();
          GA.copyText(textOf.get(el) || "");
          GA.icons.swap(copyBtn, "check");
          setTimeout(
            () => !state.destroyed && GA.icons.swap(copyBtn, "copy"),
            GA.config.COPY_FEEDBACK_MS,
          );
        },
      },
      GA.icons.make("copy"),
    );
    el.appendChild(GA.el("div", { class: "ga-msg-actions" }, copyBtn));
  }

  function scrollToBottom(force) {
    if (force)
      calm.toBottom(); // sending your own message re-sticks
    else calm.follow();
  }

  function setLoading(v) {
    if (state.destroyed) return;
    state.loading = v;
    root.classList.toggle("ga-loading", v);
    // Input disabling and the Ask↔Stop button swap live in GA.Composer.
    composer.setLoading(v);
  }

  // The view-state setters below share one options shape: { persist = true }.
  // Pass { persist: false } when mirroring already-stored state (initial
  // restore, the controller's transient modal minimize) so nothing writes back
  // unchanged.
  function setUnread(v, { persist = true } = {}) {
    const on = !!v;
    if (!!thread.unread === on && persist) return;
    thread.unread = on;
    root.classList.toggle("ga-unread", on);
    if (persist) handlers.persist && handlers.persist(thread);
  }

  // Minimized = a compact chip (icon-ish pill with snippet + count); the box
  // restores on click.
  function setCollapsed(v, opts) {
    const { persist = true } = opts || {};
    state.collapsed = !!v;
    root.classList.toggle("ga-collapsed", state.collapsed);
    GA.icons.swap(minimizeBtn, state.collapsed ? "restore" : "minimize");
    minimizeBtn.title = state.collapsed ? "Restore" : "Minimize";
    minimizeBtn.setAttribute("aria-label", state.collapsed ? "Restore thread" : "Minimize thread");
    minimizeBtn.setAttribute("aria-pressed", state.collapsed ? "true" : "false");
    thread.collapsed = state.collapsed;
    if (!state.collapsed) {
      setUnread(false, opts);
      flushHistory(); // an expanding chip promised its full history
    }
    invalidateHeight();
    if (persist) handlers.persist && handlers.persist(thread);
    // A collapse/restore is a discrete jump — worth easing the reflow.
    handlers.onResize && handlers.onResize({ animate: true });
  }

  // Resolved = archived-but-restorable: collapses to a muted chip, fades the
  // highlight, swaps the composer for a Reopen bar. Distinct from delete.
  function setResolved(v, opts) {
    state.resolved = !!v;
    root.classList.toggle("ga-resolved", state.resolved);
    thread.resolved = state.resolved;
    if (state.resolved) thread.resolvedAt = Date.now();
    else delete thread.resolvedAt;
    GA.selection.setHighlightState(
      thread.id,
      state.resolved ? "resolved" : state.active ? "active" : null,
    );
    // Resolving tucks the thread away; reopening brings it back expanded.
    setCollapsed(state.resolved, opts);
  }

  function askDelete() {
    // A thread with no conversation and an empty composer has nothing to
    // lose — delete it without the confirm popover.
    if (!(thread.messages || []).length && !composer.draft().trim()) {
      handlers.onDelete && handlers.onDelete(thread);
      return;
    }
    confirm.show();
  }
  function hideDelete() {
    confirm.hide();
  }

  // ---- turn wiring (orchestration lives in thread-turn.js) ----

  function makeTurnOps() {
    return {
      appendUser: (text, meta) => appendMessage("user", text, meta),
      beginModel: (meta) => streamView.beginModel(meta),
      renderModel: (el, text) => streamView.renderModel(el, text),
      renderError: (el, message) => streamView.renderError(el, message),
      endModel: (el) => streamView.endModel(el),
      setLoading: setLoading,
      ask: handlers.ask,
      persist: handlers.persist,
    };
  }

  // GA.Composer already trimmed the text, gated on loading, snapshotted the
  // undo stack and cleared the box — only the turn itself lives here.
  function submit(q, sendOpts) {
    // /label is a command, not a question — the shared intercept keeps it
    // away from the LLM. Append-vs-convert policy lives in the controller;
    // conversion destroys this box, hence the destroyed guard on the tail.
    if (GA.tryLabelCommand(q, thread, handlers, () => !state.destroyed && labelStrip.render()))
      return;
    GA.threadTurn
      .run(thread, q, makeTurnOps(), sendOpts)
      .then(() => !state.destroyed && handlers.onResize && handlers.onResize());
  }

  function retryTurn(errorEl) {
    if (state.loading || state.destroyed) return;
    errorEl.remove(); // the error message record is popped by threadTurn.retry
    invalidateHeight();
    GA.threadTurn
      .retry(thread, makeTurnOps())
      .then(() => !state.destroyed && handlers.onResize && handlers.onResize());
  }

  // public API used by the gutter / controller
  return {
    id: thread.id,
    thread,
    el: root,
    focusInput() {
      textarea.focus();
    },
    // Draft handoff with the modal: take = read-and-clear on expand, set =
    // hand the (possibly edited) draft back on close.
    takeDraft() {
      const d = composer.draft();
      composer.setDraft("");
      return d;
    },
    setDraft(text) {
      composer.setDraft(text);
      invalidateHeight();
    },
    setActive(active) {
      state.active = !!active;
      root.classList.toggle("ga-active", state.active);
      if (state.active) setUnread(false);
    },
    setDimmed(dim) {
      root.classList.toggle("ga-dimmed", !!dim);
    },
    isCompact() {
      return state.collapsed;
    },
    setCollapsed(v, opts) {
      setCollapsed(v, opts);
    },
    setResolved(v) {
      setResolved(v);
    },
    // Re-render the whole history from thread.messages — used after a modal
    // session added turns the docked box hasn't seen.
    refreshMessages() {
      if (state.destroyed) return;
      // Full eager rebuild — reset the lazy-fill state FIRST or a pending
      // idle batch would duplicate messages into the fresh DOM.
      if (idleHandle) {
        cancelIdle(idleHandle);
        idleHandle = 0;
      }
      pendingHistory = 0;
      oldestRendered = null;
      messagesEl.textContent = "";
      (thread.messages || []).forEach((m) => appendMessage(m.role, m.text, m));
      updateChipCount();
      // The modal can also have EDITED LABELS — refresh means the whole record.
      labelStrip.render();
      invalidateHeight();
    },
    setOrphan: GA.makeOrphanToggle({ root, header, snippet, onChange: invalidateHeight }),
    // Height the box would take unconstrained (chrome + full messages scroll
    // height), and the chrome alone (header + labels + live composer — the
    // incompressible part the layout engine must plan around). One cached
    // measurement pass serves both; pure reads — no style write/restore, so
    // measuring N boxes in the relayout read phase doesn't force N reflows.
    naturalHeight() {
      return measureHeights().natural;
    },
    chromeHeight() {
      return measureHeights().chrome;
    },
    invalidateHeight,
    setMaxHeight(px) {
      const next = px == null ? "" : Math.max(GA.config.BOX_MESSAGES_MIN_PX, px) + "px";
      if (messagesEl.style.maxHeight !== next) messagesEl.style.maxHeight = next;
    },
    destroy() {
      state.destroyed = true;
      streamView.cancel();
      if (idleHandle) {
        cancelIdle(idleHandle);
        idleHandle = 0;
      }
      root.remove();
    },
  };
};
