// research.js — pure pieces of Research Mode: the neutral tool definitions,
// limits, system prompt, the source-id registry the model cites by `[n]`,
// tool-result formatting, the read_page URL guard and the Sources footer.
// The loop (background/research-loop.js) and the tool shell
// (background/research-tools.js) own every fetch; nothing here touches I/O.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.research = (function () {
  // Neutral shape; each provider adapter (src/<provider>/tools.js) maps it to
  // its own wire format.
  const TOOL_DEFS = [
    {
      name: "web_search",
      description:
        "Search the web. Returns numbered results (title, URL, snippet); cite them by their [n] id.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query, a few precise keywords." },
        },
        required: ["query"],
      },
    },
    {
      name: "read_page",
      description:
        "Fetch a web page and return its main text. Use a URL from the search results; cite it by its [n] id.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The absolute http(s) URL of the page to read." },
        },
        required: ["url"],
      },
    },
  ];

  const LIMIT_DEFAULTS = { maxSteps: 8, maxSearches: 5, maxPages: 3 };
  // [settings key, limit key, min, max]
  const LIMIT_RANGES = [
    ["researchMaxSteps", "maxSteps", 2, 15],
    ["researchMaxSearches", "maxSearches", 0, 10],
    ["researchMaxPages", "maxPages", 0, 8],
  ];

  // Settings come from a number input and storage, so strings are normal; ""
  // and anything non-numeric fall back to the default rather than to 0.
  function clampLimits(settings) {
    const s = settings || {};
    const out = {};
    for (const [field, key, min, max] of LIMIT_RANGES) {
      const v = s[field];
      const n =
        typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      out[key] = Number.isFinite(n)
        ? Math.min(max, Math.max(min, Math.round(n)))
        : LIMIT_DEFAULTS[key];
    }
    return out;
  }

  // Stable prefix first and the date last, so providers that cache prompt
  // prefixes reuse everything but the final line.
  function buildSystemPrompt(opts) {
    const o = opts || {};
    const limits = o.limits || LIMIT_DEFAULTS;
    const canSearch = o.canSearch !== false && limits.maxSearches > 0;
    const canRead = !!o.canRead && limits.maxPages > 0;
    const lines = [
      "You are a research assistant inside Marginalia, a browser extension. The user highlighted part of an AI chat answer and asked a question about it.",
    ];
    if (canSearch || canRead) {
      lines.push("", "Tools:");
      if (canSearch)
        lines.push(
          "- web_search(query): numbered web results. At most " + limits.maxSearches + " searches.",
        );
      if (canRead)
        lines.push(
          "- read_page(url): the main text of one page. At most " + limits.maxPages + " pages.",
        );
      lines.push(
        "You have at most " + limits.maxSteps + " steps in total; each reply you make is one step.",
        "",
        "How to research:",
      );
      if (canSearch) lines.push("- Search first, with short precise queries.");
      if (canRead)
        lines.push("- Read only the one or two most relevant pages; snippets are often enough.");
      else lines.push("- Pages cannot be read in this session; work from search snippets.");
      lines.push(
        "- Never repeat a tool call with the same input.",
        "- If a tool fails, continue; if nothing works, answer from your own knowledge and say it is unverified.",
      );
    } else {
      lines.push(
        "",
        "No research tools are available in this session. Answer from your own knowledge and say it is unverified.",
      );
    }
    lines.push(
      "",
      "Final answer:",
      "- Plain Markdown, concise, focused on the highlighted part and the question.",
      "- Cite sources as [n] right after each claim they support, using only ids you received from tools.",
      "- Do not write a sources or references list; it is appended automatically.",
    );
    if (o.today) lines.push("", "Today's date: " + o.today + ".");
    return lines.join("\n");
  }

  function normalizeUrl(url) {
    const raw = String(url == null ? "" : url).trim();
    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      u.hash = "";
      const drop = [];
      u.searchParams.forEach(function (v, k) {
        if (/^utm_/i.test(k)) drop.push(k);
      });
      for (const k of drop) u.searchParams.delete(k);
      let s = u.protocol + "//" + u.host.toLowerCase() + u.pathname.replace(/\/+$/, "");
      if (u.search) s += u.search;
      return s;
    } catch (e) {
      return null;
    }
  }

  function cleanTitle(title, cap) {
    const t = String(title == null ? "" : title)
      .replace(/\s+/g, " ")
      .trim();
    return t.length > cap ? t.slice(0, cap - 1).replace(/\s+$/, "") + "…" : t;
  }

  // Source-id registry: ids are 1-based in first-seen order and stable for the
  // whole run, so a page found by two searches keeps one id. `titleChars`
  // arrives as an option (callers pass GA.config.RESEARCH_SOURCE_TITLE_CHARS)
  // so this file never reads config at load time.
  function makeSources(opts) {
    const titleChars = (opts && opts.titleChars) || 120;
    const items = []; // [{n, title, url, read}]
    const byKey = {};

    function copy(it) {
      return { n: it.n, title: it.title, url: it.url, read: it.read };
    }

    return {
      // -> n, or null for a missing / non-http(s) url.
      add(src) {
        const url = src && typeof src.url === "string" ? src.url.trim() : "";
        const key = normalizeUrl(url);
        if (!key) return null;
        const title = cleanTitle(src.title, titleChars);
        const hit = byKey[key];
        if (hit) {
          if (!hit.title && title) hit.title = title;
          return hit.n;
        }
        const it = { n: items.length + 1, title: title, url: url, read: false };
        items.push(it);
        byKey[key] = it;
        return it.n;
      },
      get(n) {
        const it = items[n - 1];
        return it ? copy(it) : null;
      },
      markRead(n) {
        const it = items[n - 1];
        if (it) it.read = true;
        return !!it;
      },
      list() {
        return items.map(copy);
      },
      size() {
        return items.length;
      },
    };
  }

  // Registers every result in `sources` and lists them by id for the model.
  function formatSearchResult(results, sources) {
    const blocks = [];
    for (const r of results || []) {
      const n = r && sources.add(r);
      if (!n) continue;
      const src = sources.get(n);
      const lines = ["[" + n + "] " + (src.title || src.url), src.url];
      const snippet = r.snippet ? String(r.snippet).replace(/\s+/g, " ").trim() : "";
      if (snippet) lines.push(snippet);
      blocks.push(lines.join("\n"));
    }
    return blocks.length ? blocks.join("\n\n") : "No results.";
  }

  function formatPage(page) {
    const p = page || {};
    const head = "[" + p.n + "] " + (p.title || p.url) + "\n" + p.url;
    const body = p.text ? String(p.text) : "(The page has no readable text.)";
    const note = p.truncated ? "\n\n(Only the start of the page is shown.)" : "";
    return head + "\n\n" + body + note;
  }

  // IPv4 literal as four octets, or null.
  function ipv4(host) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!m) return null;
    const o = m.slice(1).map(Number);
    return o.every((x) => x <= 255) ? o : null;
  }

  // read_page guard: public http(s) hosts only. Names and literals only — DNS
  // rebinding is out of scope (the fetch omits credentials either way).
  function isFetchableUrl(url) {
    let u;
    try {
      u = new URL(String(url == null ? "" : url).trim());
    } catch (e) {
      return false;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host[0] === "[" || host.indexOf(":") >= 0) return false; // IPv6 literal
    if (host === "localhost" || /\.(localhost|local|internal)$/.test(host)) return false;
    const o = ipv4(host);
    if (o) {
      const [a, b] = o;
      if (a === 0 || a === 10 || a === 127) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a >= 224) return false; // multicast / reserved / broadcast
      return true;
    }
    if (/^[\d.]+$/.test(host)) return false; // odd numeric forms URL didn't normalise
    return host.indexOf(".") > 0; // single-label names are intranet hosts
  }

  // Sorted unique ids from `[n]` and `[n, m]` markers.
  function citedIds(text) {
    const seen = {};
    const re = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;
    let m;
    while ((m = re.exec(String(text == null ? "" : text)))) {
      for (const part of m[1].split(",")) {
        const n = parseInt(part, 10);
        if (n > 0) seen[n] = true;
      }
    }
    return Object.keys(seen)
      .map(Number)
      .sort((a, b) => a - b);
  }

  // Footer listing the cited sources that exist; when the answer cites none,
  // the pages that were read (what the answer actually drew on); else nothing.
  function appendSourcesMarkdown(text, sources) {
    const body = String(text == null ? "" : text);
    let picked = citedIds(body)
      .map((n) => sources.get(n))
      .filter(Boolean);
    if (!picked.length) picked = sources.list().filter((s) => s.read);
    if (!picked.length) return body;
    const lines = picked.map((s) => "[" + s.n + "] " + (s.title ? s.title + " — " : "") + s.url);
    return body.replace(/\s+$/, "") + "\n\n---\nSources\n" + lines.join("\n");
  }

  return {
    TOOL_DEFS,
    LIMIT_DEFAULTS,
    clampLimits,
    buildSystemPrompt,
    makeSources,
    formatSearchResult,
    formatPage,
    isFetchableUrl,
    citedIds,
    appendSourcesMarkdown,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.research;
