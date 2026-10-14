// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import copy from "../../src/shared/copy.js";

// shared/copy.js is the single source of truth for the trust line (issue #14)
// and the per-provider key/pricing links (issue #17). These specs pin its
// contract and guard the hand-copied places (docs, welcome page) against drift.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("copy.TRUST_LINE", () => {
  it("says keys stay local and go only to the chosen provider, never to us", () => {
    expect(copy.TRUST_LINE).toMatch(/browser profile/);
    expect(copy.TRUST_LINE).toMatch(/only to the provider you choose/);
    expect(copy.TRUST_LINE).toMatch(/there is no 'us'/);
    for (const name of ["OpenAI", "Google", "Anthropic", "OpenRouter", "Brave"]) {
      expect(copy.TRUST_LINE).toContain(name);
    }
  });

  it("appears verbatim in the store-listing draft (ops/instructions.md)", () => {
    expect(read("ops/instructions.md")).toContain(copy.TRUST_LINE);
  });
});

describe("copy.isKeyError", () => {
  it.each([
    "OpenAI API error (HTTP 401): Incorrect API key provided: sk-…",
    "Anthropic API error (HTTP 403): forbidden",
    "Google AI API error (HTTP 400): API key not valid. Please pass a valid API key.",
    "Add your OpenAI API key in the extension's settings to use ChatGPT.",
    "Set a Gemini API key in Options to answer with Gemini.",
    "Add your Claude API key in Marginalia's options.",
  ])("is true for a key/auth failure: %s", (message) => {
    expect(copy.isKeyError(message)).toBe(true);
  });

  it.each([
    "OpenAI API error (HTTP 429): rate limited",
    "Anthropic API error (HTTP 500): overloaded",
    "OpenAI request timed out.",
    "Gemini request failed (HTTP 403).",
    "Connection to extension closed.",
    "",
    null,
    undefined,
  ])("is false for everything else: %s", (message) => {
    expect(copy.isKeyError(message)).toBe(false);
  });
});

describe("copy.PROVIDER_LINKS", () => {
  const entries = Object.entries(copy.PROVIDER_LINKS);

  it("has an entry for the search provider as well as the AI providers", () => {
    expect(Object.keys(copy.PROVIDER_LINKS).sort()).toEqual(
      ["brave", "chatgpt", "claude", "gemini", "openrouter"].sort(),
    );
  });

  it.each(entries)("%s links to https key + pricing pages", (id, links) => {
    expect(links.keyUrl).toMatch(/^https:\/\/[^\s]+$/);
    expect(links.pricingUrl).toMatch(/^https:\/\/[^\s]+$/);
  });

  it("carries no hardcoded prices", () => {
    expect(JSON.stringify(copy.PROVIDER_LINKS)).not.toMatch(/\$\s?\d/);
  });

  it("every provider in both registries has an entry, so a new provider fails until added", async () => {
    const sites = (await import("../../src/core/sites.js")).default;
    const { PROVIDERS } = (await import("../../src/background/registry.js")).default;
    for (const id of Object.keys(sites.PROVIDERS)) expect(copy.PROVIDER_LINKS[id], id).toBeTruthy();
    for (const id of Object.keys(PROVIDERS)) expect(copy.PROVIDER_LINKS[id], id).toBeTruthy();
  });
});

describe("copy.fillTrustLines", () => {
  it("fills every [data-trust-line] element under the root and leaves the rest alone", () => {
    document.body.innerHTML =
      '<p data-trust-line></p><div><p data-trust-line></p><p id="other">keep</p></div>';
    copy.fillTrustLines(document);
    const filled = [...document.querySelectorAll("[data-trust-line]")];
    expect(filled).toHaveLength(2);
    filled.forEach((p) => expect(p.textContent).toBe(copy.TRUST_LINE));
    expect(document.getElementById("other").textContent).toBe("keep");
  });
});
