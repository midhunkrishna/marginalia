import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

const GA = loadGA(["src/search/engines.js", "src/search/brave.js", "src/search/ddg.js"]);
const { ENGINES, pick } = GA.search.engines;

describe("search.engines", () => {
  it("resolves engines lazily, whatever the load order", () => {
    expect(ENGINES.ddg).toBe(GA.search.ddg);
    expect(ENGINES.brave).toBe(GA.search.brave);
  });

  it("picks Brave only when selected with a key", () => {
    expect(pick({ searchProvider: "brave", searchApiKey: " k " })).toEqual({
      id: "brave",
      engine: GA.search.brave,
      key: "k",
    });
    for (const s of [
      { searchProvider: "brave", searchApiKey: "" },
      { searchProvider: "brave", searchApiKey: "   " },
      { searchProvider: "ddg", searchApiKey: "k" },
      {},
      undefined,
    ])
      expect(pick(s)).toEqual({ id: "ddg", engine: GA.search.ddg, key: "" });
  });
});
