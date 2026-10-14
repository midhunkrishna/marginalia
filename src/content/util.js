// util.js — shared namespace + helpers for all content scripts.
// All content scripts run in the same isolated-world global scope (manifest load order),
// so `GA` is shared across files. The guarded `typeof` form is safe to repeat
// per file, in any load order (a bare `GA ||` would throw if a file ran first
// in a fresh scope, e.g. under a test loader).
var GA = (typeof GA !== "undefined" && GA) || {};

// Settings shape lives in shared/settings-schema.js (one source of truth across
// the content script, background, and options page).
GA.SETTINGS_KEY = GA.schema.SETTINGS_KEY;
GA.DEFAULT_SETTINGS = GA.schema.DEFAULT_SETTINGS;

GA.settings = Object.assign({}, GA.DEFAULT_SETTINGS);

GA.loadSettings = async function () {
  try {
    const obj = await browser.storage.local.get(GA.SETTINGS_KEY);
    const stored = obj[GA.SETTINGS_KEY] || {};
    GA.settings = Object.assign({}, GA.DEFAULT_SETTINGS, stored, {
      shortcut: Object.assign({}, GA.DEFAULT_SETTINGS.shortcut, stored.shortcut || {}),
    });
  } catch (e) {
    GA.settings = Object.assign({}, GA.DEFAULT_SETTINGS);
  }
  return GA.settings;
};

GA.log = function () {
  if (GA.settings && GA.settings.debug)
    console.log.apply(console, ["[marginalia]"].concat([].slice.call(arguments)));
};
GA.warn = function () {
  console.warn.apply(console, ["[marginalia]"].concat([].slice.call(arguments)));
};

GA.uid = function (prefix) {
  return (prefix || "t") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
};

// Which AI site we're on ("gemini" | "chatgpt" | "claude" | null), derived once
// from the host. Drives the backend client, the answer selectors, and the
// per-conversation storage key. (Registry lives in core/sites.js, unit-testable.)
GA.provider = GA.core.sites.providerForHost(location.hostname);

// A stable per-tab token (survives SPA navigation and reloads, distinct across
// tabs). Namespaces the pre-id draft bucket so two tabs of the same site can't
// steal each other's draft threads when one of them gets a conversation id.
// When sessionStorage is blocked (private/partitioned browsing) we fall back
// to one FIXED token rather than a fresh random one: a random per-load token
// would resolve every reload to a brand-new draft bucket and orphan the
// previous load's drafts. With the sentinel, all this-provider tabs share a
// single draft bucket — shared beats lost. (Must stay synchronous: everything
// below reads GA.tabToken at load time, so no async storage fallback here.)
GA.tabToken = (function () {
  try {
    let t = sessionStorage.getItem("ga:tab");
    if (!t) {
      t = GA.uid("tab");
      sessionStorage.setItem("ga:tab", t);
    }
    return t;
  } catch (e) {
    return "tab_shared"; // stable across reloads — same draft bucket every load
  }
})();

// Storage key for the current conversation: "<provider>:<id>", or null before a
// chat has an id (the store then uses a per-provider draft bucket). Qualifying by
// provider keeps two sites' conversation ids from colliding in one storage area.
GA.getSessionId = function () {
  const id = GA.core.sites.sessionIdFromPath(GA.provider, location.pathname);
  return id ? GA.provider + ":" + id : null;
};

// Tiny DOM builder. Never injects raw HTML — text is set via textContent.
GA.el = function (tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
      else if (k === "dataset" && typeof v === "object") Object.assign(node.dataset, v);
      else if (k.slice(0, 2) === "on" && typeof v === "function")
        node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    }
  }
  if (children != null) {
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
  }
  return node;
};

GA.truncate = function (s, n) {
  s = String(s || "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

// Height (as a px string) that fits a textarea's content — and, while it is
// empty, its full (possibly wrapped) placeholder. A textarea only sizes from
// `rows`, never from its placeholder; CSS `field-sizing: content` would, but
// it isn't cross-browser and the explicit height the autosize writes would
// override it anyway. So measure the placeholder as if it were the value
// (.value writes fire no events).
GA.fitTextarea = function (textarea) {
  const prev = textarea.style.height;
  textarea.style.height = "auto";
  let sh = textarea.scrollHeight;
  if (!textarea.value && textarea.placeholder) {
    textarea.value = textarea.placeholder;
    sh = Math.max(sh, textarea.scrollHeight);
    textarea.value = "";
  }
  // A hidden textarea (display:none ancestor) measures 0 — keep whatever
  // height it had rather than pinning 0px that survives un-hiding.
  if (!sh) return prev;
  // Grow-to-fit: everything typed stays visible (no internal scroll) up to a
  // viewport fraction — the gutter's corridor math absorbs the growth by
  // pinning the box bottom and raising its top. TEXTAREA_MAX_PX is the floor
  // so short viewports keep a usable input.
  const cap = Math.max(
    GA.config.TEXTAREA_MAX_PX,
    Math.round(window.innerHeight * (GA.config.TEXTAREA_GROW_MAX_FRAC || 0)),
  );
  return Math.min(sh, cap) + "px";
};

// Whether the browser supports CSS Anchor Positioning WELL ENOUGH to glue the
// comment boxes to their highlights during scroll (the gutter then skips all
// per-frame JS repositioning). A parse check (CSS.supports) is NOT enough: a
// browser can parse `anchor()` yet fail to resolve our anchors (Firefox began
// parsing these properties before the resolution behavior matured), in which
// case `top: anchor(top, 0px)` silently falls back to 0px and every box piles
// up at the viewport top. So probe the actual BEHAVIOR: place a hidden anchor
// at a known position and check that an anchored fixed element lands on it.
GA.supportsCssAnchor = (function () {
  let cached = null;
  return function () {
    if (cached !== null) return cached;
    cached = false;
    try {
      if (
        !window.CSS ||
        !CSS.supports ||
        !CSS.supports("anchor-name: --ga-probe") ||
        !CSS.supports("top: anchor(top, 0px)") ||
        !document.body
      )
        return cached;
      const anchor = document.createElement("div");
      anchor.style.cssText =
        "position:fixed;left:-9999px;top:137px;width:1px;height:1px;" +
        "visibility:hidden;pointer-events:none;anchor-name:--ga-probe;";
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;left:-9999px;width:1px;height:1px;" +
        "visibility:hidden;pointer-events:none;position-anchor:--ga-probe;top:anchor(top, 0px);";
      document.body.appendChild(anchor);
      document.body.appendChild(probe);
      cached = Math.abs(probe.getBoundingClientRect().top - 137) < 1;
      anchor.remove();
      probe.remove();
    } catch (e) {
      cached = false;
    }
    return cached;
  };
})();

// Copy text to the clipboard with a confirming toast. Clipboard access can be
// denied on some pages — fall back to a quiet failure toast.
GA.copyText = function (text) {
  const p =
    navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(text)
      : Promise.reject(new Error("clipboard unavailable"));
  p.then(
    () => GA.toast("Copied"),
    () => GA.toast("Couldn't copy — clipboard blocked on this page."),
  );
};

// Brief status toast. With opts.sticky it instead shows a persistent,
// dismissible notice (see GA.stickyToast); plain calls are unchanged.
//   opts: { sticky?, link?: { text, href }, onDismiss?() }
GA.toast = function (msg, opts) {
  if (opts && opts.sticky) return GA.stickyToast(msg, opts);
  let t = document.querySelector(".ga-toast");
  if (!t) {
    t = GA.el("div", { class: "ga-toast", role: "status", "aria-live": "polite" });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("ga-toast-show");
  clearTimeout(GA._toastTimer);
  GA._toastTimer = setTimeout(function () {
    t.classList.remove("ga-toast-show");
  }, GA.config.TOAST_MS);
};

// A persistent notice that stays until the user dismisses it, optionally with
// one outbound link. It is its own element (never the shared auto-hiding
// .ga-toast), so a later GA.toast("Copied") can't clobber it. At most one is
// shown at a time: a new call replaces the previous one.
//   opts: { link?: { text, href }, onDismiss?() }  -> the toast element
GA.stickyToast = function (msg, opts) {
  const o = opts || {};
  const old = document.querySelector(".ga-sticky-toast");
  if (old) old.remove();
  function dismiss() {
    t.remove();
    if (o.onDismiss) o.onDismiss();
  }
  const kids = [GA.el("span", { class: "ga-sticky-toast-text", text: msg })];
  if (o.link) {
    kids.push(
      GA.el("a", {
        class: "ga-sticky-toast-link",
        href: o.link.href,
        target: "_blank",
        rel: "noopener noreferrer",
        text: o.link.text,
      }),
    );
  }
  kids.push(
    GA.el("button", {
      class: "ga-sticky-toast-close",
      type: "button",
      "aria-label": "Dismiss",
      text: "×",
      onclick: dismiss,
    }),
  );
  const t = GA.el("div", { class: "ga-sticky-toast", role: "status", "aria-live": "polite" }, kids);
  document.body.appendChild(t);
  return t;
};

// Shared edge/corner drag-resize for the flex-centered dialogs (thread modal,
// threads panel). The dialog is centered, so keeping the dragged edge under
// the cursor means the size changes by 2*delta — and the box stays centered
// through the whole drag for free. Mouse events, not pointer — no capture
// needed and they run in jsdom. Sizes clamp to [min, maxFrac * viewport];
// session memory is the caller's business (onEnd).
//
// opts: { width?: {min, maxFrac, fallback}, height?: {min, maxFrac, fallback},
//         onEnd?({w, h}) }  — omit an axis to skip its handles entirely
//         (the thread modal is width-only).
// Returns { end } — tears down an in-flight drag (call from dialog onClose).
GA.dragResize = function (panel, overlay, opts) {
  let live = null; // the active drag's mouseup teardown
  const clamp = (min, max, v) => Math.max(min, Math.min(max, Math.round(v)));
  const startSize = (styleVal, rectVal, fallback) => parseInt(styleVal, 10) || rectVal || fallback;
  function start(h) {
    return function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      const sX = e.clientX;
      const sY = e.clientY;
      const rect = panel.getBoundingClientRect();
      const sW = h.sx ? startSize(panel.style.width, rect.width, opts.width.fallback) : 0;
      const sH = h.sy ? startSize(panel.style.height, rect.height, opts.height.fallback) : 0;
      const maxW = h.sx ? Math.round(window.innerWidth * opts.width.maxFrac) : 0;
      const maxH = h.sy ? Math.round(window.innerHeight * opts.height.maxFrac) : 0;
      function move(ev) {
        if (h.sx)
          panel.style.width = clamp(opts.width.min, maxW, sW + h.sx * 2 * (ev.clientX - sX)) + "px";
        if (h.sy)
          panel.style.height =
            clamp(opts.height.min, maxH, sH + h.sy * 2 * (ev.clientY - sY)) + "px";
      }
      function up() {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        overlay.classList.remove("ga-modal-resizing");
        overlay.style.removeProperty("--ga-resize-cursor");
        live = null;
        if (opts.onEnd)
          opts.onEnd({
            w: parseInt(panel.style.width, 10) || 0,
            h: parseInt(panel.style.height, 10) || 0,
          });
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      overlay.classList.add("ga-modal-resizing");
      // the "every descendant" drag cursor comes from a CSS var, per direction
      overlay.style.setProperty("--ga-resize-cursor", h.cursor);
      live = up;
    };
  }
  [
    { cls: "ga-modal-resize ga-modal-resize-left", sx: -1, sy: 0, cursor: "ew-resize" },
    { cls: "ga-modal-resize ga-modal-resize-right", sx: 1, sy: 0, cursor: "ew-resize" },
    { cls: "ga-modal-resize-y ga-modal-resize-top", sx: 0, sy: -1, cursor: "ns-resize" },
    { cls: "ga-modal-resize-y ga-modal-resize-bottom", sx: 0, sy: 1, cursor: "ns-resize" },
    { cls: "ga-modal-resize-c ga-modal-resize-tl", sx: -1, sy: -1, cursor: "nwse-resize" },
    { cls: "ga-modal-resize-c ga-modal-resize-tr", sx: 1, sy: -1, cursor: "nesw-resize" },
    { cls: "ga-modal-resize-c ga-modal-resize-bl", sx: -1, sy: 1, cursor: "nesw-resize" },
    { cls: "ga-modal-resize-c ga-modal-resize-br", sx: 1, sy: 1, cursor: "nwse-resize" },
  ].forEach(function (h) {
    if ((h.sx && !opts.width) || (h.sy && !opts.height)) return;
    panel.appendChild(GA.el("div", { class: h.cls, onmousedown: start(h) }));
  });
  return {
    end() {
      if (live) live();
    },
  };
};
