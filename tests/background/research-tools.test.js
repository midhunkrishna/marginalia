import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGA } from "../helpers/loadGA.js";

// research-tools.js: the fetch shell behind web_search / read_page. Stub fetch
// returns Response-like objects; tools resolve {content, ...} or throw a
// user-readable Error.

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const fixture = (f) => fs.readFileSync(path.join(FIX, f), "utf8");

function load() {
  return loadGA([
    "src/shared/config.js",
    "src/background/api-util.js",
    "src/core/html-text.js",
    "src/core/research.js",
    "src/search/brave.js",
    "src/search/ddg.js",
    "src/search/engines.js",
    "src/background/research-tools.js",
  ]);
}

function res(status, body, type, extra) {
  return Object.assign(
    {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h) => (h.toLowerCase() === "content-type" ? type || null : null) },
      text: () => Promise.resolve(body),
    },
    extra,
  );
}

// Response whose body streams `chunks` (Uint8Arrays) and records cancel().
function streamingRes(chunks, type) {
  const state = { reads: 0, cancelled: false };
  const r = res(200, "", type, {
    body: {
      getReader() {
        return {
          read() {
            if (state.cancelled || state.reads >= chunks.length)
              return Promise.resolve({ done: true, value: undefined });
            return Promise.resolve({ done: false, value: chunks[state.reads++] });
          },
          cancel() {
            state.cancelled = true;
            return Promise.resolve();
          },
        };
      },
    },
  });
  return { r, state };
}

function recorder(respond) {
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve().then(() => respond(url, init));
  };
  return { calls, fetchImpl };
}

// fetch that never settles until its signal aborts (then rejects AbortError).
function hangingFetch(url, init) {
  return new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      reject(e);
    });
  });
}

describe("researchTools.web_search", () => {
  it("brave with a key: keyed GET, credentials omitted, results registered as sources", async () => {
    const GA = load();
    const { calls, fetchImpl } = recorder(() =>
      res(200, fixture("brave-results.json"), "application/json"),
    );
    const t = GA.researchTools.make({
      settings: { searchProvider: "brave", searchApiKey: "bk" },
      fetchImpl,
    });
    const out = await t.web_search({ query: "rust borrow checker" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("https://api.search.brave.com/res/v1/web/search?q=rust");
    expect(calls[0].url).toContain("count=8");
    expect(calls[0].init.headers["X-Subscription-Token"]).toBe("bk");
    expect(calls[0].init.credentials).toBe("omit");
    expect(out.content).toContain("[1] References and Borrowing");
    expect(out.sources[0]).toEqual({
      n: 1,
      title: "References and Borrowing - The Rust Programming Language",
      url: "https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html",
    });
    expect(out.sources.map((s) => s.n)).toEqual(out.sources.map((_, i) => i + 1));
    expect(t.sources.size()).toBe(out.sources.length);
  });

  it("repeat hits keep their ids across searches", async () => {
    const GA = load();
    const { fetchImpl } = recorder(() => res(200, fixture("brave-results.json"), "x"));
    const t = GA.researchTools.make({
      settings: { searchProvider: "brave", searchApiKey: "bk" },
      fetchImpl,
    });
    const a = await t.web_search({ query: "a" });
    const b = await t.web_search({ query: "b" });
    expect(b.sources).toEqual(a.sources);
  });

  it("ddg without a key parses the HTML page", async () => {
    const GA = load();
    const { calls, fetchImpl } = recorder(() => res(200, fixture("ddg-results.html"), "text/html"));
    const t = GA.researchTools.make({
      settings: { searchProvider: "brave", searchApiKey: "" },
      fetchImpl,
    });
    const out = await t.web_search({ query: "tides" });
    expect(calls[0].url).toBe("https://html.duckduckgo.com/html/?q=tides");
    expect(out.sources.length).toBeGreaterThan(0);
    expect(out.content).toContain("[1] ");
  });

  it("ddg challenge page throws the add-a-key message", async () => {
    const GA = load();
    const { fetchImpl } = recorder(() =>
      res(200, "<html><div class='anomaly-modal'>captcha</div></html>", "text/html"),
    );
    const t = GA.researchTools.make({ settings: {}, fetchImpl });
    await expect(t.web_search({ query: "q" })).rejects.toThrow(/DuckDuckGo blocked the request/);
  });

  it("no results yields 'No results.' and no sources", async () => {
    const GA = load();
    const { fetchImpl } = recorder(() =>
      res(200, "<html><body>nothing</body></html>", "text/html"),
    );
    const t = GA.researchTools.make({ settings: {}, fetchImpl });
    expect(await t.web_search({ query: "q" })).toEqual({ content: "No results.", sources: [] });
  });

  it("HTTP error throws with the engine label", async () => {
    const GA = load();
    const { fetchImpl } = recorder(() =>
      res(429, JSON.stringify({ message: "rate limited" }), "application/json"),
    );
    const t = GA.researchTools.make({
      settings: { searchProvider: "brave", searchApiKey: "bk" },
      fetchImpl,
    });
    await expect(t.web_search({ query: "q" })).rejects.toThrow(
      "Brave Search API error (HTTP 429): rate limited",
    );
  });

  it("an empty query is a tool error without a fetch", async () => {
    const GA = load();
    const { calls, fetchImpl } = recorder(() => res(200, "", "text/html"));
    const t = GA.researchTools.make({ settings: {}, fetchImpl });
    await expect(t.web_search({ query: "  " })).rejects.toThrow(/empty/);
    expect(calls).toHaveLength(0);
  });

  it("the run's signal aborting surfaces as AbortError", async () => {
    const GA = load();
    const ac = new AbortController();
    const t = GA.researchTools.make({ settings: {}, signal: ac.signal, fetchImpl: hangingFetch });
    const p = t.web_search({ query: "q" });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("a stalled engine times out as a plain (non-abort) error", async () => {
    const GA = load();
    GA.config.RESEARCH_TOOL_TIMEOUT_MS = 10;
    const t = GA.researchTools.make({ settings: {}, fetchImpl: hangingFetch });
    const err = await t.web_search({ query: "q" }).catch((e) => e);
    expect(err.message).toBe("DuckDuckGo timed out.");
    expect(err.name).not.toBe("AbortError");
  });
});

describe("researchTools.read_page", () => {
  const URL1 = "https://example.org/tides";

  it("happy path: fetches without credentials, extracts, registers + marks read", async () => {
    const GA = load();
    const { calls, fetchImpl } = recorder(() =>
      res(200, fixture("article-page.html"), "text/html; charset=utf-8"),
    );
    const t = GA.researchTools.make({ settings: {}, canRead: true, fetchImpl });
    const out = await t.read_page({ url: URL1 });
    expect(calls[0].url).toBe(URL1);
    expect(calls[0].init).toMatchObject({ redirect: "follow", credentials: "omit" });
    expect(out.n).toBe(1);
    expect(out.title).toMatch(/How Tides Work/);
    expect(out.chars).toBeGreaterThan(0);
    expect(out.content.startsWith("[1] " + out.title + "\n" + URL1 + "\n\n")).toBe(true);
    expect(t.sources.get(1)).toMatchObject({ url: URL1, read: true });
  });

  it("reuses the id a search already gave the url", async () => {
    const GA = load();
    const { fetchImpl } = recorder(() => res(200, "<title>X</title><p>hi</p>", "text/html"));
    const t = GA.researchTools.make({ settings: {}, canRead: true, fetchImpl });
    t.sources.add({ title: "a", url: "https://a.example/" });
    t.sources.add({ title: "Tides from search", url: URL1 });
    const out = await t.read_page({ url: URL1 });
    expect(out.n).toBe(2);
    expect(out.title).toBe("Tides from search");
  });

  it("text/plain is passed through raw, capped", async () => {
    const GA = load();
    GA.config.READ_PAGE_MAX_CHARS = 5;
    const { fetchImpl } = recorder(() => res(200, "hello world", "text/plain"));
    const t = GA.researchTools.make({ settings: {}, canRead: true, fetchImpl });
    const out = await t.read_page({ url: URL1 });
    expect(out.chars).toBe(5);
    expect(out.content).toContain("hello");
    expect(out.content).toContain("Only the start of the page is shown");
  });

  it("rejects unfetchable urls without fetching", async () => {
    const GA = load();
    const { calls, fetchImpl } = recorder(() => res(200, "", "text/html"));
    const t = GA.researchTools.make({ settings: {}, canRead: true, fetchImpl });
    for (const url of ["http://localhost/x", "file:///etc/passwd", "http://192.168.1.1/"])
      await expect(t.read_page({ url })).rejects.toThrow("That URL can't be fetched.");
    expect(calls).toHaveLength(0);
  });

  it("canRead false throws the permission message", async () => {
    const GA = load();
    const { calls, fetchImpl } = recorder(() => res(200, "", "text/html"));
    const t = GA.researchTools.make({ settings: {}, canRead: false, fetchImpl });
    await expect(t.read_page({ url: URL1 })).rejects.toThrow(/Reading pages is off/);
    expect(calls).toHaveLength(0);
  });

  it("rejects non-text content types", async () => {
    const GA = load();
    const { fetchImpl } = recorder(() => res(200, "%PDF", "application/pdf"));
    const t = GA.researchTools.make({ settings: {}, canRead: true, fetchImpl });
    await expect(t.read_page({ url: URL1 })).rejects.toThrow(
      "Not a readable page (content-type application/pdf).",
    );
    expect(t.sources.size()).toBe(0);
  });

  it("HTTP error throws with the status", async () => {
    const GA = load();
    const { fetchImpl } = recorder(() => res(404, "<html>nope</html>", "text/html"));
    const t = GA.researchTools.make({ settings: {}, canRead: true, fetchImpl });
    await expect(t.read_page({ url: URL1 })).rejects.toThrow("The page returned HTTP 404.");
  });

  it("stops reading at READ_PAGE_MAX_BYTES and cancels the body", async () => {
    const GA = load();
    GA.config.READ_PAGE_MAX_BYTES = 10;
    const enc = new TextEncoder();
    const chunks = [enc.encode("<p>abcdef"), enc.encode("ghijkl</p>"), enc.encode("<p>never</p>")];
    const { r, state } = streamingRes(chunks, "text/html");
    const t = GA.researchTools.make({ settings: {}, canRead: true, fetchImpl: () => r });
    const out = await t.read_page({ url: URL1 });
    expect(state.cancelled).toBe(true);
    expect(state.reads).toBe(2);
    expect(out.content).toContain("abcdef");
    expect(out.content).not.toContain("ghijkl");
    expect(out.content).not.toContain("never");
  });

  it("a stop mid-read surfaces as AbortError", async () => {
    const GA = load();
    const ac = new AbortController();
    const t = GA.researchTools.make({
      settings: {},
      canRead: true,
      signal: ac.signal,
      fetchImpl: hangingFetch,
    });
    const p = t.read_page({ url: URL1 });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});
