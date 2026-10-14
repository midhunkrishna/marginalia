// blocked.js — page script for blocked.html, the help page background.js opens
// (via background/injection-guard.js) when a context-menu click finds no
// content script running. Its one job: show which site was affected. The host
// comes from the query string, which anyone can craft, so it is only ever
// written with textContent.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.blocked = (function () {
  // A real hostname is at most 253 chars; anything longer is junk, not a host.
  const MAX_HOST_LENGTH = 253;
  // Shown when no (valid) host was passed.
  const FALLBACK = "this site";

  // The ?host= value from a location.search string, or "" when absent/oversized.
  function readHost(search) {
    const host = new URLSearchParams(search || "").get("host") || "";
    return host.length > MAX_HOST_LENGTH ? "" : host;
  }

  // Put `host` (or the fallback wording) into every [data-host] slot as text.
  function renderHost(doc, host) {
    doc.querySelectorAll("[data-host]").forEach(function (el) {
      el.textContent = host || FALLBACK;
    });
  }

  // Render the affected host; `search` defaults to the live page's query string.
  function init(search) {
    renderHost(document, readHost(search === undefined ? location.search : search));
  }

  return { readHost, renderHost, init, FALLBACK };
})();

// Auto-init only on the real page (loadGA injects `module` under vitest, and
// the specs call init() themselves).
if (typeof module === "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      GA.blocked.init();
    });
  } else {
    GA.blocked.init();
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = GA.blocked;
