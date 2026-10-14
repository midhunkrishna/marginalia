import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// research.js: provider resolution, early failures, limits, the page-read
// permission, and what it hands the loop. Loop and tools are stubbed.

function load({ contains = async () => true } = {}) {
  const browser = {
    runtime: { id: "x", onMessage: { addListener() {} } },
    permissions: { contains },
  };
  const GA = loadGA(
    [
      "src/shared/protocol.js",
      "src/shared/config.js",
      "src/core/sites.js",
      "src/core/research.js",
      "src/background/api-util.js",
      "src/openai/payload.js",
      "src/googleai/payload.js",
      "src/anthropic/payload.js",
      "src/openrouter/payload.js",
      "src/background/key-test.js",
      "src/background/research.js",
    ],
    { browser },
  );
  const seen = {};
  GA.openai = Object.assign(GA.openai || {}, { tools: { label: "OpenAI" } });
  GA.anthropic = Object.assign(GA.anthropic || {}, { tools: { label: "Anthropic" } });
  GA.googleai = Object.assign(GA.googleai || {}, { tools: { label: "Google AI" } });
  GA.openrouter = Object.assign(GA.openrouter || {}, { tools: { label: "OpenRouter" } });
  GA.researchTools = {
    make(opts) {
      seen.toolsOpts = opts;
      return { web_search: async () => ({}), read_page: async () => ({}) };
    },
  };
  GA.researchLoop = {
    async run(opts) {
      seen.loopOpts = opts;
      if (opts.onText) opts.onText("hi");
      if (opts.onStep) opts.onStep({ kind: "final", step: 1 });
      return {
        text: "hi",
        sources: [{ n: 1, title: "t", url: "https://u.example/", read: false, cited: true }],
        steps: 3,
        searches: 2,
        pages: 1,
      };
    },
  };
  return { GA, seen };
}

const BASE = {
  researchProvider: "anthropic",
  anthropicApiKey: "sk-ant",
  anthropicModel: "claude-x",
};

describe("GA.research", () => {
  it("PROVIDERS mirrors key-test's rows and maps them to registry ids", () => {
    const { GA } = load();
    expect(Object.keys(GA.research.PROVIDERS).sort()).toEqual(
      Object.keys(GA.keyTest.PROVIDERS).sort(),
    );
    const ids = {};
    for (const [row, p] of Object.entries(GA.research.PROVIDERS)) ids[row] = p.registryId;
    expect(ids).toEqual({
      openai: "chatgpt",
      gemini: "gemini",
      anthropic: "claude",
      openrouter: "openrouter",
    });
    expect(GA.research.PROVIDERS.openrouter).toMatchObject({
      label: "OpenRouter",
      keyField: "openrouterApiKey",
      modelField: "openrouterModel",
    });
    expect(GA.research.PROVIDERS.gemini.adapter()).toBe(GA.googleai.tools);
    expect(GA.research.PROVIDERS.openai.adapter()).toBe(GA.openai.tools);
  });

  it("runs the loop with the provider's adapter, key, model, limits and prompt", async () => {
    const { GA, seen } = load();
    const texts = [];
    const steps = [];
    const ac = new AbortController();
    const out = await GA.research.run({
      settings: Object.assign({ researchMaxSteps: "99", researchMaxPages: 2 }, BASE),
      prompt: "PROMPT",
      signal: ac.signal,
      onText: (t) => texts.push(t),
      onStep: (s) => steps.push(s),
    });
    expect(out).toEqual({
      text: "hi",
      research: {
        provider: "claude",
        model: "claude-x",
        steps: 3,
        searches: 2,
        pages: 1,
        sources: [{ n: 1, title: "t", url: "https://u.example/", read: false, cited: true }],
      },
    });
    const o = seen.loopOpts;
    expect(o.adapter).toBe(GA.anthropic.tools);
    expect(o).toMatchObject({ model: "claude-x", key: "sk-ant", userText: "PROMPT" });
    expect(o.signal).toBe(ac.signal);
    expect(o.limits).toEqual({ maxSteps: 15, maxSearches: 5, maxPages: 2 });
    expect(Object.keys(o.tools).sort()).toEqual(["read_page", "web_search"]);
    expect(o.system).toContain("read_page(url)");
    expect(o.system).toMatch(/Today's date: \d{4}-\d{2}-\d{2}\./);
    expect(seen.toolsOpts).toMatchObject({ canRead: true, signal: ac.signal });
    expect(seen.toolsOpts.sources).toBe(o.sources);
    expect(texts).toEqual(["hi"]);
    expect(steps).toEqual([{ kind: "final", step: 1 }]);
  });

  it("without the <all_urls> grant, read_page is neither offered nor prompted", async () => {
    let asked;
    const { GA, seen } = load({
      contains: async (q) => {
        asked = q;
        return false;
      },
    });
    await GA.research.run({ settings: BASE, prompt: "p" });
    expect(asked).toEqual({ origins: ["<all_urls>"] });
    expect(seen.toolsOpts.canRead).toBe(false);
    expect(Object.keys(seen.loopOpts.tools)).toEqual(["web_search"]);
    expect(seen.loopOpts.system).not.toContain("read_page(url)");
  });

  it("a throwing permissions API counts as no grant", async () => {
    const { GA, seen } = load({
      contains: async () => {
        throw new Error("nope");
      },
    });
    await GA.research.run({ settings: BASE, prompt: "p" });
    expect(seen.toolsOpts.canRead).toBe(false);
  });

  it("maxPages 0 skips the permission check", async () => {
    let called = false;
    const { GA, seen } = load({
      contains: async () => {
        called = true;
        return true;
      },
    });
    await GA.research.run({
      settings: Object.assign({ researchMaxPages: 0 }, BASE),
      prompt: "p",
    });
    expect(called).toBe(false);
    expect(seen.toolsOpts.canRead).toBe(false);
  });

  it("fails early without a provider, key or model", async () => {
    const { GA, seen } = load();
    await expect(GA.research.run({ settings: {}, prompt: "p" })).rejects.toThrow(
      "Pick a research provider in Marginalia's options.",
    );
    await expect(
      GA.research.run({ settings: Object.assign({}, BASE, { anthropicApiKey: "" }), prompt: "p" }),
    ).rejects.toThrow("Pick a research provider in Marginalia's options.");
    await expect(
      GA.research.run({
        settings: Object.assign({}, BASE, { anthropicApiKey: "  " }),
        prompt: "p",
      }),
    ).rejects.toThrow("Add your Claude API key in Marginalia's options.");
    await expect(
      GA.research.run({ settings: Object.assign({}, BASE, { anthropicModel: "" }), prompt: "p" }),
    ).rejects.toThrow("Set a Claude model in Marginalia's options.");
    expect(seen.loopOpts).toBeUndefined();
  });

  it("stamps the registry id for each research row", async () => {
    const { GA } = load();
    const out = await GA.research.run({
      settings: {
        researchProvider: "openrouter",
        openrouterApiKey: "or",
        openrouterModel: "a/b",
      },
      prompt: "p",
    });
    expect(out.research).toMatchObject({ provider: "openrouter", model: "a/b" });
  });
});
