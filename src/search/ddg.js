// ddg.js — keyless fallback engine: DuckDuckGo's HTML results page, parsed with
// regex (the MV3 worker has no DOMParser). Best-effort by nature: DDG serves a
// bot challenge to some clients, which isBlocked() recognises so the tool can
// point the user at a search API key instead of reporting "no results".
var GA = (typeof GA !== "undefined" && GA) || {};
GA.search = GA.search || {};

GA.search.ddg = (function () {
  const ENDPOINT = "https://html.duckduckgo.com/html/";

  // Minimal stand-ins used only when core/html-text.js isn't loaded (it is,
  // before this file, in every background script list). Read at call time,
  // never at load time.
  const FALLBACK = {
    stripTags: (s) => String(s).replace(/<[^>]*>/g, ""),
    decodeEntities: (s) =>
      String(s)
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&"),
  };
  function html() {
    return (GA.core && GA.core.htmlText) || FALLBACK;
  }

  function plain(s) {
    const h = html();
    return h
      .decodeEntities(h.stripTags(String(s == null ? "" : s)))
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildRequest(query) {
    return {
      url: ENDPOINT + "?q=" + encodeURIComponent(String(query == null ? "" : query)),
      headers: {},
    };
  }

  // Result links go through DDG's redirector (//duckduckgo.com/l/?uddg=<target>);
  // hand the model the real target. Ad clicks (/y.js) and non-http(s) → null.
  function unwrapHref(href) {
    let h = html()
      .decodeEntities(String(href == null ? "" : href))
      .trim();
    if (h.indexOf("//") === 0) h = "https:" + h;
    const m = /^https?:\/\/(?:[a-z0-9-]+\.)*duckduckgo\.com\/l\/\?(?:[^#]*&)?uddg=([^&#]+)/i.exec(
      h,
    );
    if (m) {
      try {
        h = decodeURIComponent(m[1]);
      } catch (e) {
        return null;
      }
    } else if (/^https?:\/\/(?:[a-z0-9-]+\.)*duckduckgo\.com\//i.test(h)) {
      return null;
    }
    return /^https?:\/\//i.test(h) ? h : null;
  }

  // Each result is a <div class="result …"> whose inner markup nests further
  // divs, so blocks are cut from one result opener to the next rather than
  // matched to their close tag.
  const OPENER_RE = /<div\b[^>]*\bclass\s*=\s*"([^"]*)"[^>]*>/gi;

  function resultBlocks(body) {
    const starts = [];
    let m;
    OPENER_RE.lastIndex = 0;
    while ((m = OPENER_RE.exec(body))) {
      const classes = m[1].split(/\s+/);
      if (classes.indexOf("result") >= 0)
        starts.push({ at: m.index, ad: classes.indexOf("result--ad") >= 0 });
    }
    return starts.map((s, i) => ({
      ad: s.ad,
      html: body.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : body.length),
    }));
  }

  const LINK_RE = /<a\b[^>]*\bclass\s*=\s*"[^"]*\bresult__a\b[^"]*"[^>]*>([\s\S]*?)<\/a\s*>/i;
  const SNIPPET_RE =
    /<(a|td|div)\b[^>]*\bclass\s*=\s*"[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/\1\s*>/i;

  // opts.snippetChars caps each snippet (callers pass SEARCH_SNIPPET_CHARS).
  function parseResults(bodyText, opts) {
    const cap = (opts && opts.snippetChars) || 300;
    const out = [];
    const seen = {};
    for (const block of resultBlocks(String(bodyText == null ? "" : bodyText))) {
      if (block.ad) continue;
      const link = LINK_RE.exec(block.html);
      if (!link) continue;
      const href = /\bhref\s*=\s*"([^"]*)"/i.exec(link[0]);
      const url = href && unwrapHref(href[1]);
      if (!url || seen[url]) continue;
      seen[url] = true;
      const sn = SNIPPET_RE.exec(block.html);
      let snippet = sn ? plain(sn[2]) : "";
      if (snippet.length > cap) snippet = snippet.slice(0, cap - 1).replace(/\s+$/, "") + "…";
      out.push({ title: plain(link[1]) || url, url: url, snippet: snippet });
    }
    return out;
  }

  // Conservative: only a page with no parseable results AND a challenge
  // phrase counts, so an honest empty result list is never called "blocked".
  const CHALLENGE_RE =
    /anomaly-modal|anomaly\.js|captcha|bots use duckduckgo|unusual traffic|challenge-form|are you a (?:human|robot)/i;

  function isBlocked(bodyText) {
    const s = String(bodyText == null ? "" : bodyText);
    return parseResults(s).length === 0 && CHALLENGE_RE.test(s);
  }

  return {
    id: "ddg",
    label: "DuckDuckGo",
    host: "html.duckduckgo.com",
    needsKey: false,
    buildRequest,
    parseResults,
    isBlocked,
    unwrapHref,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.search.ddg;
