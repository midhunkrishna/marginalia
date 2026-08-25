// panel.js — the all-threads overview (Figma's comment sidebar, sized to our
// world): every thread in this conversation with open/resolved filters,
// click-to-jump for anchored threads, open-in-modal for the rest (orphans
// included), and reopen for resolved ones. Opened from the gutter's list
// button or Alt+Shift+A.
//
// The "All chats" tab (cross-conversation search + synthesis) lives in
// panel-global.js; this shell owns the chrome — tabs, the shared search row,
// the dialog lifecycle — and delegates that tab's body/footer to a per-open
// GA.panelGlobal instance.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.panel = (function () {
  let dlg = null; // current dialog handle (GA.dialog) — close() targets it
  let filter = "open"; // "outline" | "open" | "resolved" | "all" | "global" — persists across opens
  const STATUS_FILTERS = ["open", "resolved", "all"]; // the threads-list views behind the status dropdown
  let sessionSize = { w: 0, h: 0 }; // drag-resized panel size, remembered for this page session
  let resizer = null; // GA.dragResize handle — ends an in-flight drag on close
  // Per-open view state shared by the build/render helpers below:
  // { query, scope, body, count, searchInput, clearBtn, scopeSeg, typeSeg, chats, outline }.
  // Set in open(), nulled when the dialog closes, so a query never leaks into
  // the next open — unlike the deliberately persistent `filter`.
  let view = null;

  // ---- export for NotebookLM (T-012) ---------------------------------------
  // Decode + self-heal live in GA.convoRepair.loadDecoded (the system's sole
  // decompress site); this click handler only hands the decoded record plus
  // this conversation's threads to the pure Markdown builder and delivers via
  // a blob: download and a best-effort clipboard copy.

  // Download filename: "<sanitized title|provider>-YYYYMMDD.md". Keep only
  // [A-Za-z0-9_ -] so a captured <title> can't smuggle path separators or
  // shell metacharacters into the download attribute.
  function exportFilename(title, provider) {
    let base = String(title || "")
      .replace(/[^\w -]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60)
      .trim()
      .replace(/ /g, "-");
    if (!base) base = String(provider || "conversation");
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return base + "-" + ymd + ".md";
  }

  // Blob + temporary <a download> click. The md string only ever enters the
  // Blob (and the clipboard) — never innerHTML. The object URL is revoked in
  // finally so failure paths can't leak it either; the revoke is deferred one
  // tick because same-tick revocation right after click() is the historically
  // flaky pattern (old Firefox aborted the just-started download).
  function deliverDownload(md, filename) {
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    try {
      const a = GA.el("a", { href: url, download: filename });
      document.body.appendChild(a); // Firefox requires the anchor in the document
      a.click();
      a.remove();
    } finally {
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 0);
    }
  }

  // Whole body guarded: an unhandled rejection inside an onclick is silent,
  // and a failed export must always surface a toast instead.
  async function exportConversation() {
    try {
      const decoded = await GA.convoRepair.loadDecoded(GA.getSessionId());
      if (!decoded) {
        // Friendly degrade — never a broken or empty download. (Capture only
        // runs on annotated conversations, hence the nudge.)
        GA.toast("No transcript captured yet — it fills in as you annotate this conversation.");
        return;
      }
      const md = GA.core.transcript.build(decoded, GA.threadController.threads());
      deliverDownload(md, exportFilename(decoded.title, decoded.provider));
      // Best-effort clipboard in its OWN catch — a denied clipboard must not
      // undo the already-successful download.
      let copied = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(md);
          copied = true;
        }
      } catch (e) {}
      GA.toast(
        copied ? "Transcript downloaded and copied to clipboard." : "Transcript downloaded.",
      );
    } catch (e) {
      GA.warn("export failed", e);
      GA.toast("Export failed — couldn't build the transcript.");
    }
  }

  // ---- open-panel view (all helpers below read the module-level `view`) ----

  // Jump to a thread: anchored ones scroll into view in the margin; orphans
  // (and the no-gutter narrow viewport) open the modal instead.
  function goToThread(t) {
    close();
    const anchor = GA.selection.anchorEl(t.id);
    if (anchor && GA.gutter.mode() !== "hidden") {
      anchor.scrollIntoView({ block: "center", behavior: "smooth" });
      GA.gutter.setActive(t.id);
    } else {
      GA.threadController.expandThreadById(t.id);
    }
  }

  // "via Gemini" pill when any reply in the thread came from another provider
  // (issue #8) — the same rule as the box header.
  function viaBadge(t) {
    let label = null;
    (t.messages || []).forEach((m) => {
      if (m.role === "model") label = GA.core.sites.viaLabel(m.provider, GA.provider) || label;
    });
    if (!label) return null;
    return GA.el("span", {
      class: "ga-tag ga-panel-badge ga-panel-via",
      text: "via " + label,
      title: "Answered by " + label,
    });
  }

  function renderThreadRow(t) {
    const anchored = !!GA.selection.anchorEl(t.id);
    const row = GA.el(
      "div",
      {
        class: "ga-panel-row" + (t.resolved ? " ga-panel-row-resolved" : ""),
        role: "button",
        tabindex: "0",
        "aria-label": "Thread: " + (t.selector && t.selector.exact),
      },
      [
        GA.el("div", { class: "ga-panel-row-main" }, [
          GA.el("div", {
            class: "ga-panel-snippet",
            text: GA.truncate(t.selector && t.selector.exact, GA.config.PANEL_SNIPPET_CHARS),
          }),
          GA.el("div", { class: "ga-panel-question", text: GA.recordQuestionText(t) }),
        ]),
        GA.el("div", { class: "ga-panel-row-meta" }, [
          t.kind === "label" ? GA.labelGlyph({ on: true }) : null,
          !anchored && !t.resolved ? GA.detachedBadge("ga-panel-badge") : null,
          viaBadge(t),
          t.resolved
            ? GA.el(
                "button",
                {
                  class: "ga-iconbtn",
                  title: "Reopen",
                  "aria-label": "Reopen thread",
                  onclick: function (e) {
                    e.stopPropagation();
                    const it = GA.gutter.get(t.id);
                    // reopen through the box so state/highlight stay in sync
                    if (it && it.box.setResolved) it.box.setResolved(false);
                    renderList(); // rebuild removes the focused button…
                    view.searchInput.focus(); // …so keyboard focus needs a home
                  },
                },
                GA.icons.make("reopen"),
              )
            : null,
          GA.el("span", { class: "ga-panel-jump" }, GA.icons.make("jump")),
        ]),
      ],
    );
    row.addEventListener("click", () => goToThread(t));
    row.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        goToThread(t);
      }
    });
    return row;
  }

  // ---- Outline tab (issue #4) --------------------------------------------
  // One row per exchange ("You: <first 80 chars>") with that exchange's
  // threads nested as chips. Rows come from core/outline.build(): the stored
  // transcript index (whole conversation as far as capture has seen it) unioned
  // with the turns mounted right now (the only ones a click can scroll to).
  // Unmounted rows stay visible but inert — the page's virtualized list only
  // loads them when the user scrolls up, and there is no machinery to force
  // that.

  function liveTurns() {
    if (!GA.turns || !GA.turns.findTurns) return [];
    return GA.turns.findTurns().map((t) => ({
      el: t.el,
      role: t.role,
      fp: GA.turns.fingerprintOf(t.el),
      // Rows only ever show the first PANEL_OUTLINE_CHARS; don't drag a
      // 50 KB answer through normalize() for that.
      text: GA.turns.textOf(t.el).slice(0, 256),
    }));
  }

  function scrollToTurn(el) {
    close();
    const reduce =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }

  function renderOutlineRow(row, chips) {
    const label = GA.core.outline.ROLE_LABEL[row.role] || "Message";
    const chipEls = chips.map((t) =>
      GA.el("button", {
        class:
          "ga-tag ga-outline-chip" +
          (t.resolved ? " ga-outline-chip-resolved" : "") +
          (t.kind === "label" ? " ga-outline-chip-label" : ""),
        type: "button",
        text: GA.truncate(t.selector && t.selector.exact, GA.config.PANEL_BADGE_CHARS),
        title: t.selector && t.selector.exact,
        "aria-label": "Thread: " + (t.selector && t.selector.exact),
        onclick: function (e) {
          e.stopPropagation();
          goToThread(t); // orphans fall back to the modal, same as the list rows
        },
      }),
    );
    const props = {
      class: "ga-panel-row ga-outline-row" + (row.mounted ? "" : " ga-outline-unmounted"),
      "aria-label": label + ": " + row.text,
    };
    if (row.mounted) {
      props.role = "button";
      props.tabindex = "0";
    } else {
      props["aria-disabled"] = "true";
      props.title = "Scroll up in the chat to load this turn";
    }
    const el = GA.el("div", props, [
      GA.el("div", { class: "ga-panel-row-main" }, [
        GA.el("div", { class: "ga-outline-head" }, [
          GA.el("span", { class: "ga-panel-snippet", text: label + ": " + row.text }),
          row.mounted
            ? null
            : GA.el("span", { class: "ga-outline-hint", text: "scroll up to load" }),
        ]),
        chipEls.length ? GA.el("div", { class: "ga-outline-chips" }, chipEls) : null,
      ]),
      row.mounted ? GA.el("span", { class: "ga-panel-jump" }, GA.icons.make("jump")) : null,
    ]);
    if (row.mounted) {
      el.addEventListener("click", () => scrollToTurn(row.el));
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          scrollToTurn(row.el);
        }
      });
    }
    return el;
  }

  function renderOutline() {
    const session = GA.getSessionId();
    if (!session) {
      setCount(0, 0);
      view.body.appendChild(
        GA.el("div", {
          class: "ga-modal-empty",
          text: "Outline appears once this chat has a URL.",
        }),
      );
      return;
    }
    const st = view.outline;
    if (st.convo === undefined) {
      if (!st.loading) {
        st.loading = true;
        const p =
          GA.store && GA.store.loadConvo ? GA.store.loadConvo(session) : Promise.resolve(null);
        Promise.resolve(p)
          .catch(() => null)
          .then((record) => {
            if (!view || view.outline !== st) return; // panel closed meanwhile
            st.convo = record || null;
            st.loading = false;
            renderList();
          });
      }
      view.body.appendChild(GA.el("div", { class: "ga-modal-empty", text: "Loading…" }));
      return;
    }
    const model = GA.core.outline.build({
      live: liveTurns(),
      stored: st.convo && Array.isArray(st.convo.turns) ? st.convo.turns : [],
      threads: GA.threadController.threads(),
      provider: GA.provider,
      limit: GA.config.PANEL_OUTLINE_CHARS,
    });
    const q = view.query;
    const qn = q ? GA.core.turnId.normalize(q).toLowerCase() : "";
    let totalChips = 0;
    let shownChips = 0;
    const rowEls = [];
    for (const row of model.rows) {
      totalChips += row.threads.length;
      const chips = q
        ? row.threads.filter((t) => GA.core.threadSearch.matches(t, q))
        : row.threads.slice();
      shownChips += chips.length;
      const textHit = !q || row.text.toLowerCase().indexOf(qn) !== -1;
      if (q && !chips.length && !textHit) continue;
      rowEls.push(renderOutlineRow(row, chips));
    }
    const loose = q
      ? model.unanchored.filter((t) => GA.core.threadSearch.matches(t, q))
      : model.unanchored;
    totalChips += model.unanchored.length;
    shownChips += loose.length;
    setCount(shownChips, totalChips);

    if (!rowEls.length && !loose.length) {
      view.body.appendChild(
        GA.el("div", {
          class: "ga-modal-empty",
          text: q ? "Nothing in the outline matches your search." : "No turns yet.",
        }),
      );
      return;
    }
    rowEls.forEach((el) => view.body.appendChild(el));
    if (loose.length) {
      view.body.appendChild(GA.el("div", { class: "ga-panel-group", text: "Not on any turn" }));
      loose.forEach((t) => view.body.appendChild(renderThreadRow(t)));
    }
  }

  // ---- "All chats" search scope (issue #4) -------------------------------
  // One search box, two scopes. With scope=all and a query, every tab shows
  // hits from every conversation; picking one opens that conversation. Hits
  // from THIS conversation jump in place instead, like the list rows.
  function renderAllChatsResults() {
    const hits = view.chats.search(view.query);
    if (!hits) {
      view.chats.ensureBuckets(); // its resolution calls requestRender → back here
      view.body.appendChild(GA.el("div", { class: "ga-modal-empty", text: "Loading…" }));
      return;
    }
    setCount(hits.length, view.chats.state.total);
    if (!hits.length) {
      view.body.appendChild(
        GA.el("div", { class: "ga-modal-empty", text: "No threads match in any conversation." }),
      );
      return;
    }
    view.body.appendChild(
      GA.el("div", {
        class: "ga-panel-nav-notice",
        text: "Results from every chat — picking one from another chat opens that conversation.",
      }),
    );
    const here = GA.getSessionId();
    hits.forEach((hit) => {
      if (hit.session === here) {
        const live = GA.threadController.threads().find((t) => t.id === hit.record.id);
        if (live) {
          view.body.appendChild(renderThreadRow(live));
          return;
        }
      }
      view.body.appendChild(
        view.chats.renderNavRow(hit, {
          onNavigate: function (h) {
            view.chats.urlFor(h.session).then((url) => {
              close();
              if (url && url !== location.href) location.assign(url);
            });
          },
        }),
      );
    });
  }

  function renderList() {
    view.body.textContent = "";
    if (filter === "global") {
      view.chats.render(view.body);
      return;
    }
    if (view.scope === "all" && view.query) {
      renderAllChatsResults();
      return;
    }
    if (filter === "outline") {
      renderOutline();
      return;
    }
    const inTab = GA.threadController.threads().filter((t) => {
      if (filter === "open") return !t.resolved;
      if (filter === "resolved") return !!t.resolved;
      return true;
    });
    const threads = inTab.filter((t) => GA.core.threadSearch.matches(t, view.query));
    setCount(threads.length, inTab.length);
    if (!threads.length) {
      view.body.appendChild(
        GA.el("div", {
          class: "ga-modal-empty",
          text: view.query ? "No threads match your search." : "No threads here.",
        }),
      );
      return;
    }
    threads.forEach((t) => view.body.appendChild(renderThreadRow(t)));
  }

  // The "N of M" live search counter — shown only while a query is active.
  function setCount(shown, total) {
    if (view.query) {
      view.count.textContent = shown + " of " + total;
      view.count.classList.add("ga-panel-count-on");
    } else {
      view.count.textContent = "";
      view.count.classList.remove("ga-panel-count-on");
    }
  }

  function clearQuery() {
    view.query = "";
    view.searchInput.value = "";
    view.clearBtn.classList.remove("ga-panel-search-clear-on");
    renderList();
  }

  // Header: (Outline) (▾ Open|Resolved|All) | (Across chats). The three
  // status views share ONE control — a native select that is itself the
  // threads tab — so the header stays three pills wide with the Outline added.
  function buildTabs() {
    const tabs = GA.el("div", { class: "ga-panel-tabs" });
    const isStatus = (f) => STATUS_FILTERS.indexOf(f) !== -1;

    function sync() {
      Array.from(tabs.querySelectorAll("[data-filter]")).forEach((b) => {
        const key = b.dataset.filter;
        const on = key === "status" ? isStatus(filter) : key === filter;
        b.classList.toggle("ga-panel-tab-on", on);
        if (b.tagName !== "SELECT") b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    function select(key) {
      filter = key;
      updateChrome();
      renderList();
      sync();
    }
    function tabButton(key, label) {
      return GA.el("button", {
        class: "ga-panel-tab",
        text: label,
        // Active-tab bookkeeping keys off this, never off the rendered label
        // text (which is presentation and free to change).
        "data-filter": key,
        onclick: () => select(key),
      });
    }

    const status = GA.el(
      "select",
      {
        class: "ga-panel-tab ga-panel-status",
        "data-filter": "status",
        "aria-label": "Thread status",
        title: "Threads in this chat",
        onchange: function () {
          select(this.value);
        },
        // Picking the dropdown while another tab is active returns to the
        // threads list at the status it already shows — no change needed.
        onmousedown: function () {
          if (!isStatus(filter)) select(this.value);
        },
        onkeydown: function (e) {
          if (!isStatus(filter) && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            select(this.value);
          }
        },
      },
      [
        ["open", "Open"],
        ["resolved", "Resolved"],
        ["all", "All"],
      ].map(([key, label]) => GA.el("option", { value: key, text: label })),
    );
    // A persisted status survives close/reopen; otherwise the dropdown shows
    // the default view it will open when picked.
    status.value = isStatus(filter) ? filter : "open";

    tabs.appendChild(tabButton("outline", "Outline"));
    // appearance:none drops the native arrow; the replacement chevron is a DOM
    // svg, never a CSS url() image (a host page's CSP can block those in an
    // injected stylesheet).
    tabs.appendChild(
      GA.el("span", { class: "ga-panel-status-wrap" }, [
        status,
        GA.el("span", { class: "ga-panel-status-chev" }, GA.icons.make("chevron-down", 11)),
      ]),
    );
    // "Across chats" — deliberately NOT "All chats": beside the status
    // dropdown's "All" that read as a fourth status instead of a scope jump.
    tabs.appendChild(tabButton("global", "Across chats"));
    sync();
    return tabs;
  }

  // Search-row chrome that depends on the active tab: the type dropdown only
  // exists on All chats, and the search placeholder follows the mode.
  function updateChrome() {
    const global = filter === "global";
    // Across chats is already every conversation and shows the type
    // segments instead; the scope segments belong to every other tab.
    view.typeSeg.classList.toggle("ga-panel-seg-on", global);
    view.scopeSeg.classList.toggle("ga-panel-seg-on", !global);
    view.searchInput.placeholder = global
      ? view.chats.state.type === "labels"
        ? "Search labels…"
        : "Search all threads…"
      : view.scope === "all"
        ? "Search all chats…"
        : filter === "outline"
          ? "Filter outline…"
          : "Search threads…";
    view.chats.updateFooter();
  }

  // A two-button segmented control (the shared look for search-row modes).
  function segControl(label, items, current, onPick) {
    const seg = GA.el("div", { class: "ga-panel-seg", role: "group", "aria-label": label });
    items.forEach(([key, text]) => {
      seg.appendChild(
        GA.el("button", {
          class: "ga-panel-seg-btn" + (key === current ? " ga-panel-seg-btn-on" : ""),
          type: "button",
          text,
          "data-key": key,
          "aria-pressed": key === current ? "true" : "false",
          onclick: function () {
            Array.from(seg.children).forEach((b) => {
              const on = b.dataset.key === key;
              b.classList.toggle("ga-panel-seg-btn-on", on);
              b.setAttribute("aria-pressed", on ? "true" : "false");
            });
            onPick(key);
          },
        }),
      );
    });
    return seg;
  }

  function buildSearch() {
    // This chat | All chats — where the query looks. Lives in the search row
    // (not the tabs) because it changes what the box searches, not the view.
    view.scopeSeg = segControl(
      "Search scope",
      [
        ["chat", "This chat"],
        ["all", "All chats"],
      ],
      view.scope,
      (key) => {
        view.scope = key;
        updateChrome();
        renderList();
      },
    );
    Array.from(view.scopeSeg.children).forEach((b) => (b.dataset.scope = b.dataset.key));
    // Threads|Labels as a SEGMENTED control, not a dropdown: both modes stay
    // visible, so the labels path can't hide behind a closed select.
    view.typeSeg = GA.el("div", {
      class: "ga-panel-seg",
      role: "group",
      "aria-label": "What to search across all chats",
    });
    [
      ["threads", "Threads"],
      ["labels", "Labels"],
    ].forEach(([key, label]) => {
      view.typeSeg.appendChild(
        GA.el("button", {
          class: "ga-panel-seg-btn" + (key === "threads" ? " ga-panel-seg-btn-on" : ""),
          text: label,
          "data-type": key,
          "aria-pressed": key === "threads" ? "true" : "false",
          onclick: function () {
            view.chats.setType(key);
            Array.from(view.typeSeg.children).forEach((b) => {
              const on = b.dataset.type === key;
              b.classList.toggle("ga-panel-seg-btn-on", on);
              b.setAttribute("aria-pressed", on ? "true" : "false");
            });
            updateChrome();
            renderList();
          },
        }),
      );
    });
    view.searchInput = GA.el("input", {
      class: "ga-panel-search-input",
      type: "text",
      placeholder: "Search threads…",
      "aria-label": "Search threads by highlight or message text",
      oninput: function () {
        view.query = this.value.trim();
        view.clearBtn.classList.toggle("ga-panel-search-clear-on", !!this.value);
        renderList();
      },
    });
    view.clearBtn = GA.el(
      "button",
      {
        class: "ga-iconbtn ga-panel-search-clear",
        type: "button",
        title: "Clear search",
        "aria-label": "Clear search",
        onclick: function () {
          clearQuery();
          view.searchInput.focus();
        },
      },
      GA.icons.make("close"),
    );
    view.count = GA.el("div", { class: "ga-panel-count", "aria-live": "polite" });
    return GA.el("div", { class: "ga-panel-search" }, [
      view.scopeSeg,
      view.typeSeg,
      view.searchInput,
      view.clearBtn,
      view.count,
    ]);
  }

  // Coordinated header order (T-006 gear, T-012 export): closeBtn stays last
  // — it takes the dialog's initial focus.
  function buildHeader() {
    const title = GA.el("div", { class: "ga-modal-title", text: "Comment threads" });
    const closeBtn = GA.el(
      "button",
      { class: "ga-iconbtn", title: "Close (Esc)", "aria-label": "Close", onclick: close },
      GA.icons.make("close"),
    );
    // Content scripts can't call openOptionsPage directly — ask the background
    // (via MSG_OPEN_OPTIONS) to open it. Catch-guarded: a dead worker just no-ops.
    const gearBtn = GA.el(
      "button",
      {
        class: "ga-iconbtn",
        title: "Settings",
        "aria-label": "Settings",
        onclick: function () {
          browser.runtime.sendMessage({ type: GA.protocol.MSG_OPEN_OPTIONS }).catch(function () {});
        },
      },
      GA.icons.make("gear"),
    );
    const exportBtn = GA.el(
      "button",
      {
        class: "ga-iconbtn",
        title: "Export for NotebookLM",
        "aria-label": "Export conversation for NotebookLM",
        onclick: exportConversation,
      },
      GA.icons.make("download"),
    );
    const header = GA.el("div", { class: "ga-modal-header" }, [
      title,
      buildTabs(),
      buildSearch(),
      exportBtn,
      gearBtn,
      closeBtn,
    ]);
    return { header: header, closeBtn: closeBtn };
  }

  // The All-chats instance's window into this shell: chrome state (active
  // tab, query, count display) plus the shared blob-download delivery.
  function makeChatsCtx() {
    return {
      isActive: () => filter === "global",
      query: () => view.query,
      setCount: setCount,
      // Unconditional clear — the labels picker has no meaningful "N of M"
      // even while a query is active.
      clearCount: () => {
        view.count.textContent = "";
        view.count.classList.remove("ga-panel-count-on");
      },
      requestRender: renderList,
      download: (md, base) => deliverDownload(md, exportFilename(base, GA.provider)),
    };
  }

  function open() {
    close();
    view = {
      query: "",
      scope: "chat", // "chat" | "all" — search scope; reset per open (the box opens empty)
      scopeSeg: null,
      body: null,
      count: null,
      searchInput: null,
      clearBtn: null,
      typeSeg: null,
      chats: null,
      // Outline data is per-open: capture may have advanced since last time,
      // so the stored index is re-read on every open (convo undefined =
      // not loaded yet, null = nothing captured for this chat).
      outline: { convo: undefined, loading: false },
    };
    view.chats = GA.panelGlobal.create(makeChatsCtx());
    const built = buildHeader();
    view.body = GA.el("div", { class: "ga-modal-body ga-panel-body" });
    const footer = view.chats.buildFooter();
    updateChrome();
    renderList();

    const panelEl = GA.el("div", { class: "ga-modal ga-panel" }, [built.header, view.body, footer]);
    if (sessionSize.w) panelEl.style.width = sessionSize.w + "px";
    if (sessionSize.h) panelEl.style.height = sessionSize.h + "px";
    dlg = GA.dialog.open({
      label: "All comment threads",
      content: panelEl,
      initialFocus: built.closeBtn,
      // Escape inside a non-empty search box clears the query and keeps the
      // panel open; otherwise the dialog closes as usual. The veto must live
      // here (GA.dialog's keydown is capture-phase) so it fires before the
      // input's own handlers.
      onEscape: function () {
        const ae = document.activeElement;
        if (ae === view.searchInput && view.searchInput.value.trim()) {
          clearQuery();
          return true; // vetoed — keep the panel open
        }
        // A typed-but-unsent prompt must survive Escape: absorb one press
        // (blur), close only on the next. Losing a composed synthesis prompt
        // to a reflexive Esc is the worst outcome this dialog can produce.
        if (ae && ae.classList && ae.classList.contains("ga-input") && ae.value.trim()) {
          ae.blur();
          return true;
        }
        // A native select's Escape means "close the dropdown", never the panel.
        if (ae && ae.tagName === "SELECT") return true;
        return false;
      },
      onClose: function () {
        if (resizer) {
          resizer.end(); // an Esc/backdrop close mid-drag must detach the doc listeners
          resizer = null;
        }
        if (view && view.chats) view.chats.onClose(); // aborts any in-flight synthesis
        dlg = null;
        view = null;
      },
    });
    resizer = GA.dragResize(panelEl, dlg.overlay, {
      width: {
        min: GA.config.MODAL_MIN_PX,
        maxFrac: GA.config.MODAL_MAX_FRAC,
        fallback: GA.config.PANEL_FALLBACK_PX,
      },
      height: {
        min: GA.config.PANEL_MIN_H_PX,
        maxFrac: GA.config.PANEL_MAX_H_FRAC,
        fallback: GA.config.PANEL_FALLBACK_H_PX,
      },
      onEnd: function (s) {
        sessionSize.w = s.w || sessionSize.w;
        sessionSize.h = s.h || sessionSize.h;
      },
    });
  }

  function close() {
    if (dlg) dlg.close();
  }

  function toggle() {
    if (dlg) close();
    else open();
  }

  return { open, close, toggle };
})();
