// research-tools.js — the shell behind Research Mode's two client-side tools,
// web_search and read_page. Every network call of a research run except the
// model's own lives here; request/parse shapes come from the pure
// src/search/* engines and core/html-text.js. Each tool resolves
// {content, ...} for the model or THROWS a user-readable Error — the loop
// (research-loop.js) turns that into a tool error and keeps going.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.researchTools = (function () {
  const READABLE_RE = /text\/html|application\/xhtml\+xml|text\/plain/i;

  // Tool fetch under its own RESEARCH_TOOL_TIMEOUT_MS budget, chained to the
  // run's signal: a user stop surfaces as AbortError (the loop rethrows it),
  // a slow host as a plain timeout error the model can work around.
  async function withBudget(signal, timeoutMsg, fn) {
    const budget = GA.makeAbortBudget(GA.config.RESEARCH_TOOL_TIMEOUT_MS, signal);
    try {
      return await fn(budget);
    } catch (e) {
      throw GA.mapBudgetError(e, budget, timeoutMsg);
    } finally {
      budget.clear();
    }
  }

  // Body up to `maxBytes`, then cancel: a huge page must not be downloaded
  // whole just to keep its first few thousand characters.
  async function readCapped(res, maxBytes, charset) {
    if (!res.body || !res.body.getReader) {
      const t = await res.text();
      return t.length > maxBytes ? t.slice(0, maxBytes) : t;
    }
    const reader = res.body.getReader();
    const parts = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.byteLength;
      if (total >= maxBytes) {
        try {
          await reader.cancel();
        } catch (e) {}
        break;
      }
    }
    const all = new Uint8Array(Math.min(total, maxBytes));
    let at = 0;
    for (const p of parts) {
      const take = p.subarray(0, all.length - at);
      all.set(take, at);
      at += take.length;
      if (at >= all.length) break;
    }
    let decoder;
    try {
      decoder = new TextDecoder(charset || "utf-8");
    } catch (e) {
      decoder = new TextDecoder("utf-8"); // unknown charset label
    }
    return decoder.decode(all);
  }

  function charsetOf(contentType) {
    const m = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType || "");
    return m ? m[1] : "";
  }

  function make(opts) {
    const o = opts || {};
    const settings = o.settings || {};
    const signal = o.signal;
    const canRead = !!o.canRead;
    const doFetch = o.fetchImpl || fetch;
    const R = GA.core.research;
    const sources =
      o.sources || R.makeSources({ titleChars: GA.config.RESEARCH_SOURCE_TITLE_CHARS });

    // -> {content, sources:[{n,title,url}]} (the hits in result order, deduped)
    async function web_search(args) {
      const query = String((args && args.query) || "").trim();
      if (!query) throw new Error("The search query is empty.");
      const picked = GA.search.engines.pick(settings);
      const engine = picked.engine;
      const body = await withBudget(signal, engine.label + " timed out.", async (budget) => {
        const req = engine.buildRequest(query, picked.key, GA.config.SEARCH_MAX_RESULTS);
        const res = await doFetch(req.url, {
          method: "GET",
          headers: req.headers,
          credentials: "omit",
          signal: budget.signal,
        });
        if (!res.ok) throw new Error(await GA.apiError(engine.label, res));
        return res.text();
      });
      if (engine.isBlocked && engine.isBlocked(body))
        throw new Error(
          "DuckDuckGo blocked the request — add a search API key in Marginalia's options.",
        );
      const results = engine.parseResults(body, { snippetChars: GA.config.SEARCH_SNIPPET_CHARS });
      const content = R.formatSearchResult(results, sources);
      // formatSearchResult registered every hit; add() on a known url just
      // returns its id, so this recovers the ids without a second registry.
      const seen = {};
      const hits = [];
      for (const r of results) {
        const n = sources.add(r);
        if (!n || seen[n]) continue;
        seen[n] = true;
        const s = sources.get(n);
        hits.push({ n: s.n, title: s.title, url: s.url });
      }
      return { content, sources: hits };
    }

    // -> {content, n, title, chars}
    async function read_page(args) {
      const url = String((args && args.url) || "").trim();
      if (!R.isFetchableUrl(url)) throw new Error("That URL can't be fetched.");
      if (!canRead)
        throw new Error("Reading pages is off (grant the permission in Marginalia's options).");
      const page = await withBudget(signal, "Reading the page timed out.", async (budget) => {
        const res = await doFetch(url, {
          redirect: "follow",
          credentials: "omit",
          signal: budget.signal,
        });
        // No body in the message: an error page is HTML noise, not a reason.
        if (!res.ok) throw new Error("The page returned HTTP " + res.status + ".");
        const type = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
        if (!READABLE_RE.test(type))
          throw new Error("Not a readable page (content-type " + (type || "unknown") + ").");
        const raw = await readCapped(res, GA.config.READ_PAGE_MAX_BYTES, charsetOf(type));
        return { raw, plain: /text\/plain/i.test(type) };
      });
      const maxChars = GA.config.READ_PAGE_MAX_CHARS;
      let extracted;
      if (page.plain) {
        const truncated = page.raw.length > maxChars;
        extracted = {
          title: "",
          text: truncated ? page.raw.slice(0, maxChars) : page.raw,
          truncated,
        };
      } else {
        extracted = GA.core.htmlText.extract(page.raw, { maxChars });
      }
      const n = sources.add({ title: extracted.title, url });
      if (n) sources.markRead(n);
      const known = n ? sources.get(n) : null;
      const title = (known && known.title) || extracted.title || url;
      const content = R.formatPage({
        n: n || "?",
        title,
        url,
        text: extracted.text,
        truncated: extracted.truncated,
      });
      return { content, n, title, chars: (extracted.text || "").length };
    }

    return { web_search, read_page, sources };
  }

  return { make };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.researchTools;
