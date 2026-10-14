// health-check.js — never fail silently. When a site redesigns, our selectors
// stop matching and the extension just... does nothing. This watches the open
// conversation and, if the selectors still find nothing after a grace period,
// shows ONE dismissible notice (per session per site) with a "Report it" link.
// In debug mode it also records which selector tier died (log + the
// `data-ga-health` attribute on <html>) to speed up the fix.
//
// The verdict itself is pure (core/selector-health.js); this module only
// gathers match counts, owns the clock, and surfaces the result.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.healthCheck = (function () {
  const REPORTED_PREFIX = "ga:health:";
  const reportedInMemory = new Set(); // fallback when sessionStorage is blocked

  // How many elements the selector list matches; a selector the browser
  // rejects counts as matching nothing rather than throwing.
  function countMatches(selectors) {
    if (!selectors || !selectors.length) return 0;
    try {
      return document.querySelectorAll(selectors.join(", ")).length;
    } catch (e) {
      return 0;
    }
  }

  // The current match counts for every selector tier of this provider.
  function observeCounts() {
    const sites = GA.core.sites;
    const turns = sites.turnSelectors(GA.provider);
    return {
      turnCounts: { user: countMatches(turns.user), model: countMatches(turns.model) },
      responseCounts: countMatches(sites.responseSelectors(GA.provider)),
    };
  }

  // Whether the hint was already shown (or dismissed) for this site this session.
  function alreadyReported() {
    try {
      return sessionStorage.getItem(REPORTED_PREFIX + GA.provider) != null;
    } catch (e) {
      return reportedInMemory.has(GA.provider);
    }
  }

  // Remember the hint was shown, so it never repeats this session for this site.
  function markReported() {
    reportedInMemory.add(GA.provider);
    try {
      sessionStorage.setItem(REPORTED_PREFIX + GA.provider, "1");
    } catch (e) {
      /* blocked storage — the in-memory flag still holds for this page load */
    }
  }

  // The installed extension version, or null when the manifest is unreachable.
  function extensionVersion() {
    try {
      return browser.runtime.getManifest().version;
    } catch (e) {
      return null;
    }
  }

  // Show the one-time dismissible notice with a prefilled report link.
  function showNotice(tier) {
    const href = GA.core.selectorHealth.reportUrl({
      provider: GA.provider,
      tier: tier,
      version: extensionVersion(),
    });
    GA.toast(
      "Marginalia can't find answers on this page — the site may have changed. " +
        "Check for an extension update, or",
      { sticky: true, link: { text: "Report it", href: href } },
    );
  }

  // Debug-only diagnostics: which tier died, in the log and on <html>.
  function recordDebug(verdict) {
    if (!(GA.settings && GA.settings.debug)) return;
    const flag = verdict.status === "broken" ? "broken:" + verdict.tier : verdict.status;
    document.documentElement.setAttribute("data-ga-health", flag);
    if (verdict.status === "broken") {
      GA.log("selector health: no matches for tier '" + verdict.tier + "' on", GA.provider);
    }
  }

  // The watcher. `restart()` begins (or re-arms, after a route change) the
  // observation of the current conversation; returns { restart, stop }.
  function watch() {
    let timer = null;
    let session = null;
    let startedAt = 0;

    function stop() {
      if (timer != null) clearInterval(timer);
      timer = null;
    }

    // One poll: re-arm on a missed navigation, hold the clock while the tab is
    // hidden (throttled hydration is not a redesign), then judge and act.
    function tick() {
      if (GA.getSessionId() !== session) return restart();
      if (document.hidden) {
        startedAt = Date.now();
        return;
      }
      const verdict = GA.core.selectorHealth.evaluate(
        Object.assign(observeCounts(), {
          sessionId: session,
          elapsedMs: Date.now() - startedAt,
          threshold: GA.config.HEALTH_THRESHOLD_MS,
        }),
      );
      recordDebug(verdict);
      if (verdict.status === "pending") return;
      stop();
      if (verdict.status === "broken") {
        markReported();
        showNotice(verdict.tier);
      }
    }

    function restart() {
      stop();
      session = GA.getSessionId();
      if (!session || !GA.provider || alreadyReported()) return;
      startedAt = Date.now();
      timer = setInterval(tick, GA.config.HEALTH_POLL_MS);
    }

    return { restart, stop };
  }

  return { watch };
})();
