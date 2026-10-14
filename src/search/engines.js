// engines.js — search-engine table and the per-run choice between them.
// Lookups are lazy getters so load order among the search files doesn't matter.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.search = GA.search || {};

GA.search.engines = (function () {
  const ENGINES = {
    get ddg() {
      return GA.search.ddg;
    },
    get brave() {
      return GA.search.brave;
    },
  };

  // Brave only with a key; otherwise the keyless DuckDuckGo HTML fallback.
  function pick(settings) {
    const s = settings || {};
    const key = typeof s.searchApiKey === "string" ? s.searchApiKey.trim() : "";
    if (s.searchProvider === "brave" && key)
      return { id: "brave", engine: ENGINES.brave, key: key };
    return { id: "ddg", engine: ENGINES.ddg, key: "" };
  }

  return { ENGINES, pick };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.search.engines;
