// composer.js — the ask/stop input, shared by the modal (and available to
// any surface that needs to send a follow-up): a full-width textarea over a
// controls row (MD toggle left, Ask right). Same classes everywhere
// (.ga-composer/.ga-input/.ga-send) so every surface looks identical.
//
// GA.Composer({ placeholder, ariaLabel, onSubmit(text, {md, provider, research}), onStop(),
//               onResize(), markdownToggle, resizable, providers, researchToggle,
//               quickActions })
//   -> { el, textarea, focus(), setLoading(bool), draft(), setDraft(text),
//        hideQuickActions() }
// Enter and Cmd/Ctrl+Enter submit; Shift+Enter inserts a newline — and so
// does plain Enter while the caret sits inside an unclosed ``` fence (code
// lines shouldn't fight the send key; Cmd/Ctrl+Enter always sends).
// markdownToggle adds the MD button: the user chooses PER MESSAGE whether it
// is sent (and rendered) as markdown. resizable adds a drag grip above the
// textarea (modal-sized surfaces only). providers (core/sites.askOptions
// output) adds the "Answer with" picker (issue #8) when there is more than
// one choice; the submit bag carries `provider` ONLY for a non-site pick, so
// the default path leaves records untouched. researchToggle
// (core/sites.researchOption output, {label, model} | null) adds the Research
// button after MD: while on, the picker hides (research answers with the
// provider picked in Options), the send button reads "Research", and the
// submit bag is {md, research: true} with no `provider`.
// quickActions ([{id, label, prompt}], issue #10) adds a `.ga-chips` row of
// one-tap buttons above the textarea. A tap SENDS the chip's prompt exactly
// like a typed message (same {md, research?, provider?} bag, current toggles);
// Shift-click / Shift+Enter on a chip pre-fills the textarea for editing
// instead. The row hides after the first send of any kind (and via
// hideQuickActions(), for a first turn that ran on another surface). With
// Research on, chips are marked (accent ring, title, aria-label).
var GA = (typeof GA !== "undefined" && GA) || {};

// The MD toggle's last state is the session default: a writer who flips it on
// is probably sending more markdown — new composers open the way the last one
// was left. Resets with the page (deliberately not persisted).
let composerMdDefault = false;
// Same for the provider pick: the last choice is the session default (null =
// the site's own model). Not persisted — a stored default would quietly route
// every future tangent elsewhere; the toggle should ask again after a reload.
let composerProviderDefault = null;
// Research toggle: same session-default rule as MD (a researcher asks several
// research questions in a row), same not-persisted reason as the provider.
let composerResearchDefault = false;

GA.Composer = function (opts) {
  let loading = false;
  let mdOn = opts.markdownToggle ? composerMdDefault : false;
  const researchOpt = opts.researchToggle || null;
  let researchOn = researchOpt ? composerResearchDefault : false;
  let manualPx = 0; // grip-set height; while non-zero, autosize stands down

  const textarea = GA.el("textarea", {
    class: "ga-input",
    rows: "1",
    placeholder: opts.placeholder || "Ask a follow-up…",
    "aria-label": opts.ariaLabel || opts.placeholder || "Ask a follow-up",
  });
  const idleLabel = () => (researchOn ? "Research" : "Ask");
  const sendBtn = GA.el("button", {
    class: "ga-send",
    text: idleLabel(),
    "aria-label": "Send question",
    onclick: function () {
      if (loading) opts.onStop && opts.onStop();
      else submit();
    },
  });
  const mdBtn = opts.markdownToggle
    ? GA.el(
        "button",
        {
          class: "ga-iconbtn ga-md-btn" + (mdOn ? " ga-md-on" : ""),
          title: "Send as markdown",
          "aria-label": "Send as markdown",
          "aria-pressed": mdOn ? "true" : "false",
          onclick: function () {
            mdOn = !mdOn;
            composerMdDefault = mdOn;
            mdBtn.classList.toggle("ga-md-on", mdOn);
            mdBtn.setAttribute("aria-pressed", mdOn ? "true" : "false");
          },
        },
        GA.icons.make("markdown"),
      )
    : null;
  const researchBtn = researchOpt
    ? GA.el(
        "button",
        {
          class: "ga-iconbtn ga-research-btn" + (researchOn ? " ga-research-on" : ""),
          title: "Research this (searches the web with " + researchOpt.label + ")",
          "aria-label": "Research this with " + researchOpt.label,
          "aria-pressed": researchOn ? "true" : "false",
          onclick: function () {
            researchOn = !researchOn;
            composerResearchDefault = researchOn;
            applyResearch();
          },
        },
        GA.icons.make("globe"),
      )
    : null;
  // ---- provider picker (issue #8) ----
  const providers = Array.isArray(opts.providers) ? opts.providers : [];
  const siteEntry = providers.find((p) => p.site) || providers[0] || null;
  let providerId = siteEntry ? siteEntry.id : null;
  if (composerProviderDefault && providers.some((p) => p.id === composerProviderDefault)) {
    providerId = composerProviderDefault;
  }
  let providerWrap = null;
  if (providers.length > 1) {
    const select = GA.el(
      "select",
      {
        class: "ga-provider-select",
        title: "Answer with",
        "aria-label": "Answer with",
        onchange: function () {
          providerId = select.value;
          composerProviderDefault = providerId;
        },
      },
      providers.map((p) =>
        GA.el("option", {
          value: p.id,
          text: p.site ? p.label + " (this site)" : p.label + (p.model ? " · " + p.model : ""),
        }),
      ),
    );
    select.value = providerId;
    providerWrap = GA.el("span", { class: "ga-provider-wrap" }, [
      select,
      GA.el("span", { class: "ga-provider-chev" }, GA.icons.make("chevron-down", 11)),
    ]);
  }
  // A non-site pick travels with the message; the site's own model is the
  // absent default (missing `provider` on a record always means the site's).
  function chosenProvider() {
    return providerId && siteEntry && providerId !== siteEntry.id ? providerId : null;
  }

  const controls = GA.el("div", { class: "ga-composer-controls" }, [
    mdBtn,
    researchBtn,
    providerWrap,
    sendBtn,
  ]);
  // ---- quick-action chips (issue #10) ----
  const chips = Array.isArray(opts.quickActions) ? opts.quickActions : [];
  const chipBtns = chips.map(buildChip);
  const chipsRow = chipBtns.length
    ? GA.el("div", { class: "ga-chips", role: "group", "aria-label": "Quick actions" }, chipBtns)
    : null;
  const el = GA.el("div", { class: "ga-composer" }, [chipsRow, textarea, controls]);

  // Reflect researchOn everywhere it shows: the button, the picker (research
  // ignores it), the idle send label, the placeholder and the chips.
  const basePlaceholder = textarea.placeholder;
  function applyResearch() {
    if (!researchBtn) return;
    applyChipMode();
    researchBtn.classList.toggle("ga-research-on", researchOn);
    researchBtn.setAttribute("aria-pressed", researchOn ? "true" : "false");
    if (providerWrap) providerWrap.hidden = researchOn;
    textarea.placeholder = researchOn
      ? "Ask a research question about the highlighted text…"
      : basePlaceholder;
    if (!loading) sendBtn.textContent = idleLabel();
  }
  applyResearch();
  applyChipMode();

  /** One chip button: tap sends, Shift+click / Shift+Enter pre-fills instead. */
  function buildChip(action) {
    const btn = GA.el("button", { class: "ga-chip", type: "button", text: action.label });
    btn.addEventListener("click", function (e) {
      if (e.shiftKey) prefillFromChip(action);
      else sendChip(action);
    });
    btn.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || !e.shiftKey) return;
      e.preventDefault(); // suppress the native Enter-click; this is "edit first"
      prefillFromChip(action);
    });
    return btn;
  }

  /** Stamp every chip's tooltip + aria-label for the current Research state. */
  function applyChipMode() {
    if (!chipsRow) return;
    chipsRow.classList.toggle("ga-chips-research", researchOn);
    chipBtns.forEach(function (btn, i) {
      const verb = researchOn ? "Research" : "Ask";
      btn.title =
        chips[i].prompt +
        (researchOn ? "\n(Research is on — searches the web)" : "") +
        "\nTap to send · Shift-click to edit first";
      btn.setAttribute("aria-label", verb + ": " + chips[i].label);
    });
  }

  /** Chip tap: send the prompt now, leaving any half-typed draft untouched. */
  function sendChip(action) {
    if (loading) return;
    dispatch(action.prompt);
  }

  /** Shift-chip: put the prompt in the textarea (caret at end) for editing. */
  function prefillFromChip(action) {
    if (loading) return;
    setDraft(action.prompt);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  /** Remove the chip row once a conversation has started. */
  function hideQuickActions() {
    if (!chipsRow || chipsRow.hidden) return;
    chipsRow.hidden = true;
    opts.onResize && opts.onResize();
  }

  function autosize() {
    if (manualPx) return; // the user chose a height — keep it
    const prev = textarea.style.height;
    const next = GA.fitTextarea(textarea);
    textarea.style.height = next;
    if (next !== prev && opts.onResize) opts.onResize();
  }
  textarea.addEventListener("input", autosize);
  textarea.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
      // Plain Enter inside an unclosed ``` fence means "next code line", not
      // send — let the native newline through. Cmd/Ctrl+Enter always sends.
      const insideFence =
        !e.metaKey &&
        !e.ctrlKey &&
        (textarea.value.slice(0, textarea.selectionStart).match(/```/g) || []).length % 2 === 1;
      if (insideFence) return;
      e.preventDefault();
      if (!loading) submit();
    }
  });
  // Composer-local undo: restore text lost to a select-all-delete or the
  // clear-on-send below; re-fit the box after any restore.
  const undo = GA.attachComposerUndo(textarea, { onRestore: autosize });

  // ---- drag-to-resize grip (opts.resizable) --------------------------------
  // Same mouse-event pattern as the modal's edge resize (runs in jsdom).
  // Dragging UP grows the input; double-click returns to auto-grow.
  if (opts.resizable) {
    const grip = GA.el("div", {
      class: "ga-composer-grip",
      title: "Drag to resize the input (double-click resets)",
    });
    grip.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      const startY = e.clientY;
      const startH = manualPx || textarea.offsetHeight || parseInt(textarea.style.height, 10) || 0;
      function move(ev) {
        const max = Math.round(window.innerHeight * GA.config.COMPOSER_MANUAL_MAX_FRAC);
        manualPx = Math.max(
          GA.config.COMPOSER_MANUAL_MIN_PX,
          Math.min(max, Math.round(startH + (startY - ev.clientY))),
        );
        el.classList.add("ga-composer-manual");
        textarea.style.height = manualPx + "px";
        opts.onResize && opts.onResize();
      }
      function up() {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    grip.addEventListener("dblclick", function () {
      manualPx = 0;
      el.classList.remove("ga-composer-manual");
      autosize();
    });
    el.appendChild(grip);
  }

  function submit() {
    const q = textarea.value.trim();
    if (!q) return;
    undo.snapshot(); // remember the sent text so focus + Ctrl+Z brings it back
    textarea.value = "";
    autosize();
    dispatch(q);
  }

  /** The bag every send carries — typed or chip — from the live toggles. */
  function buildSendOpts() {
    const sendOpts = { md: mdOn };
    if (researchOn) sendOpts.research = true;
    else {
      const provider = chosenProvider();
      if (provider) sendOpts.provider = provider;
    }
    return sendOpts;
  }

  /** Hand `text` to the host with the current send options; the first send ends the chips. */
  function dispatch(text) {
    const sendOpts = buildSendOpts();
    hideQuickActions();
    opts.onSubmit && opts.onSubmit(text, sendOpts);
  }

  function setLoading(v) {
    loading = !!v;
    textarea.disabled = loading;
    chipBtns.forEach((b) => (b.disabled = loading));
    sendBtn.classList.toggle("ga-stop", loading);
    sendBtn.textContent = "";
    if (loading) {
      sendBtn.appendChild(GA.icons.make("stop"));
      sendBtn.appendChild(document.createTextNode("Stop"));
      sendBtn.setAttribute("aria-label", "Stop generating");
    } else {
      sendBtn.appendChild(document.createTextNode(idleLabel()));
      sendBtn.setAttribute("aria-label", "Send question");
    }
  }

  // Draft handoff (box ⇄ modal): plain value moves, no undo snapshot — a
  // moved draft is still the same draft.
  function draft() {
    return textarea.value;
  }
  function setDraft(text) {
    textarea.value = text == null ? "" : text;
    autosize();
  }

  return {
    el,
    textarea,
    focus() {
      textarea.focus();
    },
    setLoading,
    draft,
    setDraft,
    hideQuickActions,
  };
};
