import { describe, it, expect } from "vitest";
import citations from "../../src/core/citations.js";

const { linkify } = citations;
const SOURCES = [
  { n: 1, title: "A", url: "https://a.example/x" },
  { n: 2, title: "B", url: "https://b.example/y" },
  { n: 3, title: "C", url: "ftp://c.example" }, // non-http: never linked
];

describe("citations.linkify", () => {
  it("links known markers and leaves unknown ones", () => {
    expect(linkify("Claim [1]. Other [2][4].", SOURCES)).toBe(
      "Claim [1](https://a.example/x). Other [2](https://b.example/y)[4].",
    );
  });

  it("skips markers that are already links", () => {
    expect(linkify("[1](https://z) and [1]", SOURCES)).toBe(
      "[1](https://z) and [1](https://a.example/x)",
    );
  });

  it("does not touch code spans or fenced blocks", () => {
    const text = "x `[1]` y\n```\narr[1]\n```\n[1]";
    expect(linkify(text, SOURCES)).toBe("x `[1]` y\n```\narr[1]\n```\n[1](https://a.example/x)");
  });

  it("only links http(s) urls and tolerates empty input", () => {
    expect(linkify("[3]", SOURCES)).toBe("[3]");
    expect(linkify("[1]", [])).toBe("[1]");
    expect(linkify(null, SOURCES)).toBe("");
  });
});
