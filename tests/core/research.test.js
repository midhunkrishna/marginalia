import { describe, it, expect } from "vitest";
import research from "../../src/core/research.js";

const {
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
} = research;

describe("research.TOOL_DEFS", () => {
  it("defines web_search(query) and read_page(url) as neutral JSON-schema tools", () => {
    expect(TOOL_DEFS.map((t) => t.name)).toEqual(["web_search", "read_page"]);
    for (const t of TOOL_DEFS) {
      expect(typeof t.description).toBe("string");
      expect(t.parameters.type).toBe("object");
    }
    expect(TOOL_DEFS[0].parameters.required).toEqual(["query"]);
    expect(TOOL_DEFS[1].parameters.required).toEqual(["url"]);
  });
});

describe("research.clampLimits", () => {
  it("defaults when missing or non-numeric", () => {
    expect(clampLimits()).toEqual(LIMIT_DEFAULTS);
    expect(
      clampLimits({ researchMaxSteps: "", researchMaxSearches: "x", researchMaxPages: null }),
    ).toEqual({ maxSteps: 8, maxSearches: 5, maxPages: 3 });
    expect(clampLimits({ researchMaxSteps: NaN })).toEqual(LIMIT_DEFAULTS);
  });

  it("clamps to the ranges and accepts numeric strings", () => {
    expect(
      clampLimits({ researchMaxSteps: 1, researchMaxSearches: -3, researchMaxPages: 0 }),
    ).toEqual({
      maxSteps: 2,
      maxSearches: 0,
      maxPages: 0,
    });
    expect(
      clampLimits({ researchMaxSteps: 99, researchMaxSearches: 11, researchMaxPages: "20" }),
    ).toEqual({
      maxSteps: 15,
      maxSearches: 10,
      maxPages: 8,
    });
    expect(clampLimits({ researchMaxSteps: "4.6" }).maxSteps).toBe(5);
  });
});

describe("research.buildSystemPrompt", () => {
  const limits = { maxSteps: 6, maxSearches: 4, maxPages: 2 };

  it("lists both tools with budgets and puts the date last", () => {
    const p = buildSystemPrompt({ limits, canSearch: true, canRead: true, today: "2026-09-24" });
    expect(p).toContain("web_search(query)");
    expect(p).toContain("At most 4 searches");
    expect(p).toContain("read_page(url)");
    expect(p).toContain("At most 2 pages");
    expect(p).toContain("at most 6 steps");
    expect(p).toMatch(/Do not write a sources/);
    expect(p.endsWith("Today's date: 2026-09-24.")).toBe(true);
  });

  it("omits read_page when pages can't be read, keeping the prefix stable", () => {
    const a = buildSystemPrompt({ limits, canSearch: true, canRead: false, today: "2026-01-01" });
    const b = buildSystemPrompt({ limits, canSearch: true, canRead: false, today: "2026-01-02" });
    expect(a).not.toContain("read_page");
    expect(a).toContain("cannot be read");
    expect(a.slice(0, -12)).toBe(b.slice(0, -12));
    expect(buildSystemPrompt({ limits: { ...limits, maxPages: 0 }, canRead: true })).not.toContain(
      "read_page",
    );
  });

  it("with no tools at all, says to answer unverified", () => {
    const p = buildSystemPrompt({ limits: { maxSteps: 2, maxSearches: 0, maxPages: 0 } });
    expect(p).not.toContain("web_search");
    expect(p).toContain("No research tools");
    expect(p).not.toContain("Today's date");
  });
});

describe("research.makeSources", () => {
  it("assigns 1-based ids and dedupes by normalised URL", () => {
    const s = makeSources();
    expect(s.add({ title: "A", url: "https://Example.com/a/#frag" })).toBe(1);
    expect(s.add({ title: "B", url: "https://example.com/b" })).toBe(2);
    expect(s.add({ title: "A again", url: "https://EXAMPLE.com/a?utm_source=x" })).toBe(1);
    expect(s.add({ title: "q", url: "https://example.com/a?id=2" })).toBe(3);
    expect(s.size()).toBe(3);
    expect(s.get(1)).toEqual({ n: 1, title: "A", url: "https://Example.com/a/#frag", read: false });
    expect(s.get(9)).toBeNull();
  });

  it("rejects missing / non-http urls and fills a blank title later", () => {
    const s = makeSources();
    expect(s.add({ title: "x", url: "ftp://x" })).toBeNull();
    expect(s.add({ title: "x" })).toBeNull();
    expect(s.add(null)).toBeNull();
    expect(s.add({ url: "https://a.example" })).toBe(1);
    s.add({ title: "Now titled", url: "https://a.example/" });
    expect(s.get(1).title).toBe("Now titled");
  });

  it("caps titles and tracks read state", () => {
    const s = makeSources({ titleChars: 10 });
    s.add({ title: "  A   very long title indeed ", url: "https://a.example" });
    expect(s.get(1).title).toBe("A very lo…");
    expect(s.markRead(1)).toBe(true);
    expect(s.markRead(5)).toBe(false);
    expect(s.list()).toEqual([{ n: 1, title: "A very lo…", url: "https://a.example", read: true }]);
    s.list()[0].read = false; // copies — the registry is not mutated from outside
    expect(s.get(1).read).toBe(true);
  });
});

describe("research.formatSearchResult / formatPage", () => {
  it("registers results and lists them by id", () => {
    const s = makeSources();
    s.add({ title: "Earlier", url: "https://z.example" });
    const out = formatSearchResult(
      [
        { title: "One", url: "https://one.example", snippet: " first\n snippet " },
        { title: "", url: "https://z.example", snippet: "" },
        { title: "Bad", url: "javascript:alert(1)", snippet: "x" },
      ],
      s,
    );
    expect(out).toBe(
      "[2] One\nhttps://one.example\nfirst snippet\n\n[1] Earlier\nhttps://z.example",
    );
    expect(formatSearchResult([], s)).toBe("No results.");
  });

  it("formats a page with its id and a truncation note", () => {
    expect(formatPage({ n: 2, title: "T", url: "https://t.example", text: "Body" })).toBe(
      "[2] T\nhttps://t.example\n\nBody",
    );
    const p = formatPage({ n: 1, title: "", url: "https://u.example", text: "", truncated: true });
    expect(p).toContain("[1] https://u.example");
    expect(p).toContain("no readable text");
    expect(p).toContain("Only the start");
  });
});

describe("research.isFetchableUrl", () => {
  it("accepts public http(s) urls", () => {
    for (const u of [
      "https://example.com/x",
      "http://news.example.co.uk:8080/a?b",
      "https://8.8.8.8/",
      "https://172.32.0.1/",
      "https://192.169.1.1/",
    ])
      expect(isFetchableUrl(u), u).toBe(true);
  });

  it("rejects private, local, odd-scheme and credentialed urls", () => {
    for (const u of [
      "ftp://example.com/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "not a url",
      "",
      null,
      "http://localhost:3000/",
      "http://LOCALHOST./",
      "http://app.localhost/",
      "http://printer.local/",
      "http://svc.internal/",
      "http://intranet/",
      "http://10.1.2.3/",
      "http://127.0.0.1/",
      "http://0.0.0.0/",
      "http://169.254.169.254/latest/meta-data",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.1.1/",
      "http://2130706433/",
      "http://0x7f.1/",
      "http://[::1]/",
      "http://[2001:db8::1]/",
      "https://user:pw@example.com/",
      "https://user@example.com/",
      "http://224.0.0.1/",
    ])
      expect(isFetchableUrl(u), String(u)).toBe(false);
  });
});

describe("research.citedIds / appendSourcesMarkdown", () => {
  it("collects sorted unique ids including comma lists", () => {
    expect(citedIds("a [2] b [1][2] c [3, 5] d [0] e [x]")).toEqual([1, 2, 3, 5]);
    expect(citedIds(null)).toEqual([]);
  });

  function sources() {
    const s = makeSources();
    s.add({ title: "Alpha", url: "https://a.example" });
    s.add({ title: "Beta", url: "https://b.example" });
    s.add({ title: "", url: "https://c.example" });
    return s;
  }

  it("lists cited sources that exist", () => {
    expect(appendSourcesMarkdown("Claim [2] and [3] and [9].\n", sources())).toBe(
      "Claim [2] and [3] and [9].\n\n---\nSources\n[2] Beta — https://b.example\n[3] https://c.example",
    );
  });

  it("falls back to read pages, else leaves the text unchanged", () => {
    const s = sources();
    expect(appendSourcesMarkdown("No cites.", s)).toBe("No cites.");
    s.markRead(1);
    expect(appendSourcesMarkdown("No cites [7].", s)).toBe(
      "No cites [7].\n\n---\nSources\n[1] Alpha — https://a.example",
    );
  });
});
