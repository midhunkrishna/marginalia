// content.js — the entry point. It just wires the collaborators together; all
// the real work lives in focused modules (thread-controller, triggers,
// navigation, reanchorer, gutter, token-provider, ask-service).
var GA = (typeof GA !== "undefined" && GA) || {};

(function () {
  // Click a highlight -> focus its box; click elsewhere / Esc -> clear focus.
  function setupFocusListeners() {
    document.addEventListener("mousedown", function (e) {
      const t = e.target;
      if (t.closest && (t.closest(".ga-box") || t.closest(".ga-modal"))) return;
      const hl = t.closest && t.closest("span.ga-highlight");
      if (hl && hl.dataset.gaThread) {
        if (GA.gutter.mode() === "hidden") {
          // no gutter on very narrow windows — the highlight opens the modal
          GA.threadController.expandThreadById(hl.dataset.gaThread);
        } else {
          GA.gutter.focusThread(hl.dataset.gaThread);
        }
        return;
      }
      GA.gutter.setActive(null);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") GA.gutter.setActive(null);
    });
  }

  // Hover linking (page highlight -> box). The box -> highlight direction
  // lives in thread-ui.js. Delegated, so it costs one listener pair.
  function setupHoverListeners() {
    let hoveredThread = null;
    document.addEventListener("mouseover", function (e) {
      const hl = e.target.closest && e.target.closest("span.ga-highlight");
      const id = hl && hl.dataset.gaThread;
      if (id === hoveredThread) return;
      if (hoveredThread) GA.gutter.hoverThread(hoveredThread, false);
      hoveredThread = id || null;
      if (hoveredThread) GA.gutter.hoverThread(hoveredThread, true);
    });
  }

  (async function init() {
    await GA.loadSettings();
    browser.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && changes[GA.SETTINGS_KEY]) GA.loadSettings();
    });

    await GA.store.sweepDrafts(); // adopt stray non-empty drafts, drop empty buckets

    GA.themeDetector.start(); // boxes follow the SITE's theme, not the OS's

    GA.gutter.init();
    const ctrl = GA.threadController;
    GA.triggers.setup(() => ctrl.createFromSelection());
    GA.adder.setup(() => ctrl.createFromSelection());
    GA.keyboardNav.setup();
    setupFocusListeners();
    setupHoverListeners();
    const nav = GA.navigation.watch(() => ctrl.onRouteChange());
    GA.reanchorer.observe({
      reanchor: ctrl.reanchorOrphans,
      hasOrphans: ctrl.hasOrphans,
      checkNav: nav.checkNow,
      onSettled: () => GA.convoCapture && GA.convoCapture.schedule(), // transcript capture after streaming settles
    });

    await ctrl.restoreForSession(GA.getSessionId());
    GA.log("ready; session =", GA.getSessionId());
    GA.selectorHealth.start();
  })();
})();
