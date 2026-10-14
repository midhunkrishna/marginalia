// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";
import { makeStorageFake } from "../helpers/storage-mock.js";

// Options page "Get a key" + "Pricing" links (issue #17) and the trust line
// atop the API-keys card (issue #14). Drives the REAL options.html markup and
// options.js, so a provider row added to the page without its links — or a
// registry provider without a PROVIDER_LINKS entry — fails here.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HTML = fs.readFileSync(path.join(ROOT, "src/options/options.html"), "utf8");
const MAIN = HTML.slice(HTML.indexOf("<main"), HTML.indexOf("</main>") + "</main>".length);

const tick = () => new Promise((r) => setTimeout(r, 0));

async function setup({ initial = {} } = {}) {
  document.body.innerHTML = MAIN;
  const store = makeStorageFake({ initial, runtime: { sendMessage: async () => ({ ok: true }) } });
  const GA = loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/protocol.js",
      "src/shared/copy.js",
      "src/core/sites.js",
      "src/core/backup.js",
      "src/core/quick-actions.js",
      "src/options/options.js",
    ],
    { browser: store.browser },
  );
  await tick();
  await tick();
  return GA;
}

// The options-row ids the page ships, derived from its markup (every .provider
// row owns a "<row>-key" input) rather than hardcoded here.
const rowIds = () =>
  [...document.querySelectorAll(".provider input.key")].map((i) => i.id.replace(/-key$/, ""));

const helpOf = (rowId) =>
  document
    .getElementById(rowId + "-key")
    .closest(".provider")
    .querySelector(".key-help");

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("per-provider key help", () => {
  it("renders Get a key + Pricing for every provider row, from PROVIDER_LINKS", async () => {
    const GA = await setup();
    const ids = rowIds();
    expect(ids.sort()).toEqual(["anthropic", "gemini", "openai", "openrouter"]);
    for (const rowId of ids) {
      const links = GA.copy.PROVIDER_LINKS[GA.core.sites.RESEARCH_ROWS[rowId]];
      expect(links, rowId).toBeTruthy();
      const anchors = [...helpOf(rowId).querySelectorAll("a")];
      expect(anchors.map((a) => a.textContent)).toEqual(["Get a key ↗", "Pricing ↗"]);
      expect(anchors[0].getAttribute("href")).toBe(links.keyUrl);
      expect(anchors[1].getAttribute("href")).toBe(links.pricingUrl);
    }
  });

  it("opens every link safely: https, new tab, noopener", async () => {
    await setup();
    const anchors = [...document.querySelectorAll(".key-help a")];
    expect(anchors.length).toBe(10); // 4 rows x 2 + Brave x 2
    for (const a of anchors) {
      expect(a.getAttribute("href")).toMatch(/^https:\/\//);
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
    }
  });

  it("sits right before the key input it explains", async () => {
    await setup();
    for (const rowId of rowIds()) {
      const key = document.getElementById(rowId + "-key");
      expect(key.previousElementSibling.classList.contains("key-help")).toBe(true);
    }
  });

  it("notes the Google AI Studio free tier, and prints no prices", async () => {
    await setup();
    expect(helpOf("gemini").textContent).toMatch(/free tier/i);
    document.querySelectorAll(".key-help").forEach((el) => {
      expect(el.textContent).not.toMatch(/[$€£]\s?\d|\d\s?¢/);
    });
  });

  it("every registry provider has links, so a new provider fails until added", async () => {
    const GA = await setup();
    const { PROVIDERS } = (await import("../../src/background/registry.js")).default;
    for (const id of Object.keys(PROVIDERS)) expect(GA.copy.PROVIDER_LINKS[id], id).toBeTruthy();
    for (const id of Object.keys(GA.core.sites.PROVIDERS)) {
      expect(GA.copy.PROVIDER_LINKS[id], id).toBeTruthy();
    }
    // …and every row on the page resolves to one of them.
    for (const rowId of rowIds()) {
      expect(GA.copy.PROVIDER_LINKS[GA.core.sites.RESEARCH_ROWS[rowId]], rowId).toBeTruthy();
    }
  });
});

describe("Research card help", () => {
  it("shows the Brave key + pricing links only while Brave is the search engine", async () => {
    const GA = await setup();
    const help = document.getElementById("brave-keyhelp");
    expect(help).not.toBeNull();
    expect(help.hidden).toBe(true); // DuckDuckGo (no key) is the default
    const select = document.getElementById("search-provider");
    select.value = "brave";
    select.dispatchEvent(new Event("change"));
    await tick();
    expect(help.hidden).toBe(false);
    const [key, pricing] = [...help.querySelectorAll("a")];
    expect(key.getAttribute("href")).toBe(GA.copy.PROVIDER_LINKS.brave.keyUrl);
    expect(pricing.getAttribute("href")).toBe(GA.copy.PROVIDER_LINKS.brave.pricingUrl);
    select.value = "ddg";
    select.dispatchEvent(new Event("change"));
    await tick();
    expect(help.hidden).toBe(true);
  });

  it("starts visible when Brave was saved as the search engine", async () => {
    await setup({ initial: { "ga:settings": { searchProvider: "brave" } } });
    expect(document.getElementById("brave-keyhelp").hidden).toBe(false);
  });

  it("warns that research uses many more tokens per answer and points at pricing", async () => {
    await setup();
    const text = document.querySelector(".card.research .hint").textContent.replace(/\s+/g, " ");
    expect(text).toMatch(/many more tokens per answer/);
    expect(text).toMatch(/pricing/i);
  });
});

describe("trust line atop the API-keys card", () => {
  it("is a standalone line right after the card heading, filled from the shared copy", async () => {
    const GA = await setup();
    const h2 = [...document.querySelectorAll("h2")].find((h) => /API keys/.test(h.textContent));
    const line = h2.nextElementSibling;
    expect(line.classList.contains("trust-line")).toBe(true);
    expect(line.textContent).toBe(GA.copy.TRUST_LINE);
  });
});
