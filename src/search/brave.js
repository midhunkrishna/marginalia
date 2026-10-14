// brave.js — Brave Search API engine (pure: request shape + response parsing).
// Preferred over the DuckDuckGo fallback whenever the user supplied a key.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.search = GA.search || {};

GA.search.brave = (function () {
  const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

  function buildRequest(query, key, count) {
    return {
      url:
        ENDPOINT +
        "?q=" +
        encodeURIComponent(String(query == null ? "" : query)) +
        "&count=" +
        (count || 8),
      headers: { "X-Subscription-Token": key || "", Accept: "application/json" },
    };
  }

  // Brave marks query terms with <strong> in titles/descriptions; strip tags
  // and the handful of entities it emits so the model sees plain text.
  function plain(s) {
    return String(s == null ? "" : s)
      .replace(/<[^>]*>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  }

  // opts.snippetChars caps each snippet (callers pass SEARCH_SNIPPET_CHARS).
  function parseResults(bodyText, opts) {
    const cap = (opts && opts.snippetChars) || 300;
    let j;
    try {
      j = typeof bodyText === "string" ? JSON.parse(bodyText) : bodyText;
    } catch (e) {
      return [];
    }
    const rows = (j && j.web && Array.isArray(j.web.results) && j.web.results) || [];
    const out = [];
    for (const r of rows) {
      if (!r || typeof r.url !== "string" || !/^https?:\/\//i.test(r.url)) continue;
      let snippet = plain(r.description);
      if (snippet.length > cap) snippet = snippet.slice(0, cap - 1).replace(/\s+$/, "") + "…";
      out.push({ title: plain(r.title) || r.url, url: r.url, snippet: snippet });
    }
    return out;
  }

  return {
    id: "brave",
    label: "Brave Search",
    host: "api.search.brave.com",
    needsKey: true,
    buildRequest,
    parseResults,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.search.brave;
