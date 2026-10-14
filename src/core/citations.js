// citations.js — pure helper for research replies: turn bare `[n]` citation
// markers into Markdown links `[n](url)` for every n that names a known source.
// Render-time only (thread-ui/modal call it just before markdown.render): the
// stored message text keeps the bare markers so exports and prompts stay plain.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.citations = (function () {
  // sources: [{ n, url, ... }] (the reply's research.sources). Markers already
  // followed by "(" are left alone, as is anything inside fenced or inline code.
  function linkify(text, sources) {
    const s = String(text == null ? "" : text);
    const byId = {};
    for (const src of sources || []) {
      if (src && src.url && /^https?:\/\//i.test(src.url)) byId[String(src.n)] = src.url;
    }
    if (!Object.keys(byId).length) return s;
    // Split out code (fenced blocks first, then inline spans) so markers there
    // are never rewritten.
    const parts = s.split(/(```[\s\S]*?```|`[^`\n]*`)/);
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].replace(/\[(\d{1,3})\](?!\()/g, (m, n) =>
        byId[n] ? "[" + n + "](" + byId[n] + ")" : m,
      );
    }
    return parts.join("");
  }

  return { linkify };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.citations;
