// selector-health.js — B6: the category's structural killer is a host-site
// redesign that silently breaks selector matching, and users conclude the
// extension is junk. When turn discovery runs but finds zero answer containers
// for a while on a page that should have them, surface one dismissible toast
// per session per site, and flag which selector tier failed in debug logging.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.selectorHealth = (function () {
  const CHECK_MS = 10000;
  const SESSION_KEY = "ga:selector-health-warned";

  let timer = null;
  let started = false;

  function warnedThisSession(siteKey) {
    try {
      return sessionStorage.getItem(SESSION_KEY + ":" + siteKey) === "1";
    } catch (e) {
      return true; // no sessionStorage — stay silent rather than repeat
    }
  }

  function markWarned(siteKey) {
    try {
      sessionStorage.setItem(SESSION_KEY + ":" + siteKey, "1");
    } catch (e) {}
  }

  function siteKey() {
    return (GA.provider || "unknown") + ":" + location.hostname;
  }

  function check() {
    const turns = GA.turns ? GA.turns.findTurns() : [];
    const sel = GA.core.sites.turnSelector(GA.provider);
    const hasConversation =
      GA.core.sites.sessionIdFromPath &&
      GA.core.sites.sessionIdFromPath(GA.provider, location.pathname) !== null;
    const zeroTurns = turns.length === 0;

    // Only fire when there IS a conversation (the site works enough to route
    // us to a chat) but zero answer containers matched — that's the redesign
    // signature, not a slow load on an empty page.
    if (sel && hasConversation && zeroTurns && !warnedThisSession(siteKey())) {
      markWarned(siteKey());
      GA.toast(
        "Marginalia can't find answers on this page — the site may have changed. " +
          "Check for an extension update ↗ or report it at github.com/midhunkrishna/marginalia/issues.",
      );
      GA.warn("selector-health: zero answer containers for", GA.provider, "tier:", sel);
    }
  }

  function start() {
    if (started) return;
    started = true;
    timer = setInterval(check, CHECK_MS);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    started = false;
  }

  return { start, stop, check };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.selectorHealth;
