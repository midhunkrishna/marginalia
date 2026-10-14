import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGA } from "../helpers/loadGA.js";
import ddgStandalone from "../../src/search/ddg.js";

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const PAGE = fs.readFileSync(path.join(FIX, "ddg-results.html"), "utf8");
// As in the background: html-text loads first and ddg borrows its helpers.
const GA = loadGA(["src/core/html-text.js", "src/search/ddg.js"]);
const ddg = GA.search.ddg;

describe("search.ddg", () => {
  it("describes itself and builds a keyless GET", () => {
    expect(ddg).toMatchObject({ id: "ddg", host: "html.duckduckgo.com", needsKey: false });
    expect(ddg.buildRequest("rust & c++", "ignored", 8)).toEqual({
      url: "https://html.duckduckgo.com/html/?q=rust%20%26%20c%2B%2B",
      headers: {},
    });
  });

  it("parses organic results, skipping ads and unwrapping redirects", () => {
    expect(ddg.parseResults(PAGE)).toEqual([
      {
        title: "References and Borrowing - The Rust Programming Language",
        url: "https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html?a=1&b=2",
        snippet:
          "The borrow checker ensures references are always valid & that you can't have a mutable and immutable borrow at once.",
      },
      {
        title: "Borrowck, explained — a deep dive",
        url: "https://blog.example.org/borrowck-explained",
        snippet: "Non-lexical lifetimes (NLL) made the borrow checker smarter in 2018.",
      },
    ]);
  });

  it("caps snippets at snippetChars", () => {
    const [first] = ddg.parseResults(PAGE, { snippetChars: 20 });
    expect(first.snippet).toBe("The borrow checker…");
    expect(first.snippet.endsWith("…")).toBe(true);
  });

  it("works without html-text loaded (fallback helpers)", () => {
    const out = ddgStandalone.parseResults(PAGE);
    expect(out.map((r) => r.url)).toEqual(ddg.parseResults(PAGE).map((r) => r.url));
  });

  it("unwrapHref handles redirects, bare links and rejects DDG-internal/non-http", () => {
    expect(ddg.unwrapHref("//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2Fx&amp;rut=1")).toBe(
      "https://a.example/x",
    );
    expect(ddg.unwrapHref("https://b.example/")).toBe("https://b.example/");
    expect(ddg.unwrapHref("https://duckduckgo.com/y.js?ad_domain=x")).toBeNull();
    expect(ddg.unwrapHref("//duckduckgo.com/l/?uddg=javascript%3Aalert(1)")).toBeNull();
    expect(ddg.unwrapHref("//duckduckgo.com/l/?uddg=%E0%A4%A")).toBeNull();
    expect(ddg.unwrapHref("/relative")).toBeNull();
  });

  it("returns [] for pages with no results", () => {
    expect(ddg.parseResults("")).toEqual([]);
    expect(ddg.parseResults('<div class="no-results">No results.</div>')).toEqual([]);
  });

  it("isBlocked only for a result-less challenge page", () => {
    const challenge =
      '<html><body><div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div>' +
      "<p>Please complete the following challenge</p></body></html>";
    expect(ddg.isBlocked(challenge)).toBe(true);
    expect(ddg.isBlocked(PAGE)).toBe(false);
    expect(ddg.isBlocked('<div class="no-results">No results found.</div>')).toBe(false);
    expect(ddg.isBlocked(PAGE.replace("</body>", "<p>captcha</p></body>"))).toBe(false);
  });
});
