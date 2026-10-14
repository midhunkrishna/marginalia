// html-text.js — pure HTML → readable text for research read_page. Regex and
// string ops only: Chrome's MV3 service worker has no DOMParser, and one path
// that runs there and on Firefox alike beats an offscreen document. Aims for
// "the article text a model can cite", not a faithful rendering.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.htmlText = (function () {
  const NAMED = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\u00a0",
    ensp: "\u2002",
    emsp: "\u2003",
    thinsp: "\u2009",
    shy: "",
    zwj: "",
    zwnj: "",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    lsquo: "‘",
    rsquo: "’",
    sbquo: "‚",
    ldquo: "“",
    rdquo: "”",
    bdquo: "„",
    laquo: "«",
    raquo: "»",
    bull: "•",
    middot: "·",
    copy: "©",
    reg: "®",
    trade: "™",
    deg: "°",
    plusmn: "±",
    times: "×",
    divide: "÷",
    micro: "µ",
    para: "¶",
    sect: "§",
    cent: "¢",
    pound: "£",
    euro: "€",
    yen: "¥",
    frac12: "½",
    frac14: "¼",
    frac34: "¾",
    sup2: "²",
    sup3: "³",
    iexcl: "¡",
    iquest: "¿",
    larr: "←",
    rarr: "→",
    uarr: "↑",
    darr: "↓",
  };

  // Raw-text elements can hold "<tag" strings in their body (JS, CSS), so they
  // go first with a non-nesting match; everything else nests and is removed
  // by depth-counting its matching close tag.
  const RAW_RE = /<(script|style|noscript|template|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  const DROP_TAGS =
    "svg|iframe|canvas|nav|header|footer|aside|form|button|select|object|video|audio|dialog";
  const DROP_RE = new RegExp("<(" + DROP_TAGS + ")\\b[^>]*>", "i");
  const HIDDEN_RE =
    /<([a-z][a-z0-9-]*)\b[^>]*?\s(?:aria-hidden\s*=\s*["']?true\b|role\s*=\s*["']?(?:navigation|banner|contentinfo)\b|hidden(?=[\s>/]))[^>]*>/i;
  const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

  // Single pass so "&amp;lt;" decodes to "&lt;", not "<".
  function decodeEntities(s) {
    return String(s == null ? "" : s).replace(
      /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,8});/g,
      function (m, body) {
        if (body[0] === "#") {
          const cp =
            body[1] === "x" || body[1] === "X"
              ? parseInt(body.slice(2), 16)
              : parseInt(body.slice(1), 10);
          if (!cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
          return String.fromCodePoint(cp);
        }
        return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : m;
      },
    );
  }

  // Only things that look like tags: a bare "a < b" in text survives.
  function stripTags(s) {
    return String(s == null ? "" : s)
      .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
      .replace(/<\/?[A-Za-z!?][^>]*>/g, "");
  }

  // Lines trimmed, runs of spaces to one, a tab (table cell) wins over the
  // spaces around it, at most two consecutive newlines (one blank line).
  function collapseWhitespace(s) {
    return String(s == null ? "" : s)
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map(function (line) {
        return line
          .replace(/[ \f\v\u00a0\u2002\u2003\u2009]*\t[ \t\f\v\u00a0\u2002\u2003\u2009]*/g, "\t")
          .replace(/[ \f\v\u00a0\u2002\u2003\u2009]+/g, " ")
          .trim();
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Index just past the close tag matching the opener that ends at `from`, or
  // -1 when the element is never closed.
  function matchingClose(s, tag, from) {
    const re = new RegExp("<(/?)" + tag + "\\b[^>]*>", "gi");
    re.lastIndex = from;
    let depth = 1;
    let m;
    while ((m = re.exec(s))) {
      if (m[1]) depth--;
      else if (!/\/>$/.test(m[0])) depth++;
      if (depth === 0) return re.lastIndex;
    }
    return -1;
  }

  // Remove every element whose opener matches `openRe` (non-global, group 1 =
  // tag name) together with its content. An unclosed or void one loses only
  // its opener, so a malformed page doesn't lose everything after it.
  function dropElements(s, openRe) {
    let out = s;
    let guard = 0;
    let m;
    while ((m = openRe.exec(out)) && guard++ < 5000) {
      const start = m.index;
      const afterOpen = start + m[0].length;
      const end =
        VOID.test(m[1]) || /\/>$/.test(m[0]) ? afterOpen : matchingClose(out, m[1], afterOpen);
      out = out.slice(0, start) + " " + out.slice(end < 0 ? afterOpen : end);
    }
    return out;
  }

  // Inner HTML of the first element whose opener matches `openRe`, or null.
  function innerOf(s, openRe) {
    const m = openRe.exec(s);
    if (!m) return null;
    const afterOpen = m.index + m[0].length;
    const end = matchingClose(s, m[1], afterOpen);
    if (end < 0) return s.slice(afterOpen);
    return s.slice(afterOpen, s.lastIndexOf("<", end - 1));
  }

  const FOCUS = [
    /<(main)\b[^>]*>/i,
    /<(article)\b[^>]*>/i,
    /<([a-z][a-z0-9-]*)\b[^>]*?\srole\s*=\s*["']?main\b[^>]*>/i,
    /<([a-z][a-z0-9-]*)\b[^>]*?\sid\s*=\s*["']?content(?=["'\s>/])[^>]*>/i,
    /<(body)\b[^>]*>/i,
  ];

  // Paragraph-level blocks become a blank line, row-level ones a line break;
  // source newlines are layout noise except inside <pre>.
  const PARA_RE =
    /<\/?(?:p|div|section|h[1-6]|hr|table|ul|ol|dl|blockquote|pre|figure|figcaption|main|article|address|details|summary|caption)\b[^>]*>/gi;
  const LINE_RE = /<(?:br|tr|dt|dd)\b[^>]*>/gi;

  function toText(fragment) {
    const s = fragment
      .replace(/<pre\b[^>]*>[\s\S]*?<\/pre\s*>/gi, (m) => m.replace(/\n/g, "<br>"))
      .replace(/\s+/g, " ")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<(?:td|th)\b[^>]*>/gi, "\t")
      .replace(LINE_RE, "\n")
      .replace(PARA_RE, "\n\n");
    // "<li><p>x" leaves the bullet on its own line; pull the text back up.
    return collapseWhitespace(decodeEntities(stripTags(s))).replace(/^- *\n+/gm, "- ");
  }

  // Cut on the last line break inside the budget (unless that throws away more
  // than half of it) so the model never sees a half-sentence line.
  function cap(text, maxChars) {
    if (!(maxChars > 0) || text.length <= maxChars) return { text: text, truncated: false };
    let cut = text.slice(0, maxChars);
    const nl = cut.lastIndexOf("\n");
    if (nl > maxChars / 2) cut = cut.slice(0, nl);
    return { text: cut.replace(/\s+$/, "") + "\n…[truncated]", truncated: true };
  }

  function extract(html, opts) {
    const maxChars = (opts && opts.maxChars) || 0;
    let s = String(html == null ? "" : html);
    const t = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(s);
    const title = t ? collapseWhitespace(decodeEntities(stripTags(t[1]))).replace(/\n+/g, " ") : "";

    s = s.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
    s = s.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, " ");
    // Loop to a fixpoint: a raw-text block revealed by removing another (or
    // pathological nesting) is caught on the next pass.
    for (let prev = null; prev !== s;) {
      prev = s;
      s = s.replace(RAW_RE, " ");
      s = dropElements(s, DROP_RE);
      s = dropElements(s, HIDDEN_RE);
    }

    let focus = null;
    for (const re of FOCUS) {
      focus = innerOf(s, re);
      if (focus != null && stripTags(focus).trim()) break;
      focus = null;
    }
    const out = cap(toText(focus == null ? s : focus), maxChars);
    return { title: title, text: out.text, truncated: out.truncated };
  }

  return { extract, stripTags, decodeEntities, collapseWhitespace };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.htmlText;
