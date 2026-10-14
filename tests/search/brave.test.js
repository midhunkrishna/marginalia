import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import brave from "../../src/search/brave.js";

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const BODY = fs.readFileSync(path.join(FIX, "brave-results.json"), "utf8");

describe("search.brave", () => {
  it("describes itself and builds a keyed GET", () => {
    expect(brave).toMatchObject({ id: "brave", host: "api.search.brave.com", needsKey: true });
    expect(brave.buildRequest("a b&c", "KEY", 5)).toEqual({
      url: "https://api.search.brave.com/res/v1/web/search?q=a%20b%26c&count=5",
      headers: { "X-Subscription-Token": "KEY", Accept: "application/json" },
    });
    expect(brave.buildRequest("q", "K").url).toMatch(/&count=8$/);
  });

  it("parses web.results into {title,url,snippet}, dropping url-less and non-http rows", () => {
    expect(brave.parseResults(BODY)).toEqual([
      {
        title: "References and Borrowing - The Rust Programming Language",
        url: "https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html",
        snippet: "The borrow checker ensures references are always valid & safe.",
      },
      {
        title: "Borrowck explained",
        url: "https://blog.example.org/borrowck-explained",
        snippet: "",
      },
    ]);
  });

  it("caps snippets and tolerates junk bodies", () => {
    expect(brave.parseResults(BODY, { snippetChars: 10 })[0].snippet).toBe("The borro…");
    expect(brave.parseResults("not json")).toEqual([]);
    expect(brave.parseResults("{}")).toEqual([]);
    expect(brave.parseResults('{"web":{"results":null}}')).toEqual([]);
  });
});
