// welcome.js — first-run onboarding page (opened by background.js on install).
// Loads after shared/browser-polyfill.js and shared/settings-schema.js. The one
// stateful job here is the inline OpenAI key field: it writes the SAME
// `openaiApiKey` setting as the options page, so a key pasted on this page makes
// ChatGPT work immediately, with no trip to Settings.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.onboarding = (function () {
  const SETTINGS_KEY = GA.schema.SETTINGS_KEY;
  const DEFAULTS = GA.schema.DEFAULT_SETTINGS;
  const SAVE_DEBOUNCE_MS = 400; // same feel as the options page's key fields

  // Same formatting as options.js (which isn't importable — it's a page script).
  function fmtShortcut(sc) {
    const parts = [];
    if (sc.ctrl) parts.push("Ctrl");
    if (sc.alt) parts.push("Alt");
    if (sc.shift) parts.push("Shift");
    if (sc.meta) parts.push("Cmd");
    parts.push((sc.key || "").toUpperCase());
    return parts.join(" + ");
  }

  // Replace the static "Ctrl + Shift + H" markup with the user's actual
  // (rebindable) shortcut, each part as a <kbd> cap.
  function renderShortcut(label, sc) {
    label.textContent = "";
    fmtShortcut(sc)
      .split(" + ")
      .forEach(function (part, i) {
        if (i > 0) label.appendChild(document.createTextNode(" + "));
        const kbd = document.createElement("kbd");
        kbd.textContent = part;
        label.appendChild(kbd);
      });
  }

  // Write ONLY openaiApiKey, merging over a FRESH read: unlike options.js (which
  // writes its whole eval-time snapshot), this can't clobber settings the user
  // changed in an options tab after this page loaded.
  async function saveKey(value) {
    const obj = await browser.storage.local.get(SETTINGS_KEY);
    const merged = Object.assign({}, DEFAULTS, obj[SETTINGS_KEY] || {}, {
      openaiApiKey: value,
    });
    await browser.storage.local.set({ [SETTINGS_KEY]: merged });
  }

  async function init() {
    const keyInput = document.getElementById("openai-key");
    const keyStatus = document.getElementById("key-status");

    const obj = await browser.storage.local.get(SETTINGS_KEY);
    const stored = obj[SETTINGS_KEY] || {};
    const settings = Object.assign({}, DEFAULTS, stored, {
      shortcut: Object.assign({}, DEFAULTS.shortcut, stored.shortcut || {}),
    });

    keyInput.value = settings.openaiApiKey || "";

    // The trust line next to the key field comes from the shared copy.
    GA.copy.fillTrustLines(document);

    const label = document.getElementById("shortcut-label");
    if (label) renderShortcut(label, settings.shortcut);

    let timer = 0;
    keyInput.addEventListener("input", function () {
      keyStatus.textContent = "";
      clearTimeout(timer);
      timer = setTimeout(async function () {
        await saveKey(keyInput.value.trim());
        keyStatus.textContent = "Saved ✓";
      }, SAVE_DEBOUNCE_MS);
    });

    // Extension pages may open the options page directly — the background
    // MSG_OPEN_OPTIONS relay exists only because content scripts can't.
    const settingsBtn = document.getElementById("open-settings");
    if (settingsBtn)
      settingsBtn.addEventListener("click", function () {
        Promise.resolve(browser.runtime.openOptionsPage()).catch(function () {});
      });

    // Demo-mock "pop" — same behavior as the landing page's hero demo.
    const demo = document.getElementById("demo");
    const mark = document.getElementById("demoMark");
    if (demo && mark) {
      mark.addEventListener("mouseenter", function () {
        demo.classList.add("popped");
      });
      mark.addEventListener("mouseleave", function () {
        demo.classList.remove("popped");
      });
      mark.addEventListener("click", function () {
        demo.classList.toggle("popped");
      });
    }
  }

  return { init, saveKey, fmtShortcut, SAVE_DEBOUNCE_MS };
})();

// Auto-init only on the real page: under vitest, loadGA injects a `module`
// global and the specs build their DOM first, then call init() themselves.
if (typeof module === "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", GA.onboarding.init);
  } else {
    GA.onboarding.init();
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = GA.onboarding;
