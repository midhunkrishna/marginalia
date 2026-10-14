// injection-guard.js — turns the context-menu "dead click" into a diagnosis.
// The "Ask about …" menu only exists on URLs the content script is declared
// for, so when tabs.sendMessage to such a page rejects, the content script is
// NOT running there: the browser blocked injection (enterprise policy such as
// runtime_blocked_hosts, site access set to "on click", Firefox quarantined
// domains) or the tab predates the install. We never match the error text —
// Chrome and Firefox word it differently — and open a static help page instead
// (tabs.create to an extension page needs no extra permission). Uses
// browser.* only at call time, so it loads in any order before background.js.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.injectionGuard = (function () {
  // Extension-root-relative path of the help page (tests/build/wiring.test.js
  // pins that the file exists).
  const HELP_PAGE = "src/onboarding/blocked.html";
  // Repeated dead clicks inside this window reuse the tab already opened.
  const THROTTLE_MS = 8000;

  // Timestamp of the last help tab we opened (0 = never). Lives only as long as
  // the service worker, which comfortably outlasts the short throttle window.
  let lastShown = 0;

  // Hostname of an http(s) page URL, or "" for anything else/unparseable.
  function hostOf(url) {
    try {
      const u = new URL(url);
      return u.protocol === "https:" || u.protocol === "http:" ? u.hostname : "";
    } catch (e) {
      return "";
    }
  }

  // Pure decision: show the help for a page with a usable host, unless one was
  // shown less than THROTTLE_MS ago (lastShownAt: ms timestamp, or null/0).
  function shouldShowBlockedHelp(tabUrl, now, lastShownAt) {
    if (!hostOf(tabUrl)) return false;
    return !lastShownAt || now - lastShownAt >= THROTTLE_MS;
  }

  // Help-page URL for the blocked page: baseUrl plus ?host=<encoded hostname>.
  function buildHelpUrl(baseUrl, tabUrl) {
    return baseUrl + "?host=" + encodeURIComponent(hostOf(tabUrl));
  }

  // Open the help tab for a dead click on `pageUrl`, honouring the throttle.
  // Fire-and-forget: a failed tabs.create must never surface as an error.
  function reportBlocked(pageUrl) {
    const now = Date.now();
    if (!shouldShowBlockedHelp(pageUrl, now, lastShown)) return;
    lastShown = now;
    const url = buildHelpUrl(browser.runtime.getURL(HELP_PAGE), pageUrl);
    Promise.resolve(browser.tabs.create({ url })).catch(function () {});
  }

  // Send `message` to the tab's content script; if nothing answers, explain why.
  // pageUrl is the menu click's page (tab.url may be absent without host access).
  function sendOrExplain(tabId, message, pageUrl) {
    return Promise.resolve(browser.tabs.sendMessage(tabId, message)).catch(function () {
      reportBlocked(pageUrl);
    });
  }

  return { HELP_PAGE, THROTTLE_MS, hostOf, shouldShowBlockedHelp, buildHelpUrl, sendOrExplain };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.injectionGuard;
