// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadGA } from "../helpers/loadGA.js";
import { makeStorageFake } from "../helpers/storage-mock.js";

// Options-page Research mode: the per-row "Use for research" checkbox, the
// Research card (search engine + Test, page-read permission, limits). Drives
// the REAL options.html markup + options.js against fake storage, runtime and
// permissions, so the ids the script binds to are the ones actually shipped.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HTML = fs.readFileSync(path.join(ROOT, "src/options/options.html"), "utf8");
const MAIN = HTML.slice(HTML.indexOf("<main"), HTML.indexOf("</main>") + "</main>".length);

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  await tick();
  await tick();
  await tick();
};
const DEBOUNCE = () => new Promise((r) => setTimeout(r, 450));

// Fake browser.permissions: `granted` is the live grant; request resolves to
// `requestResult` (the user's answer in the browser prompt).
function makePerms({ granted = false, requestResult = true } = {}) {
  const state = { granted, requestResult, calls: [] };
  state.api = {
    request: vi.fn(async (p) => {
      state.calls.push(["request", p]);
      if (state.requestResult) state.granted = true;
      return state.requestResult;
    }),
    contains: vi.fn(async (p) => {
      state.calls.push(["contains", p]);
      return state.granted;
    }),
    remove: vi.fn(async (p) => {
      state.calls.push(["remove", p]);
      const had = state.granted;
      state.granted = false;
      return had;
    }),
  };
  return state;
}

async function setup({ initial = {}, respond = () => ({ ok: true }), perms = makePerms() } = {}) {
  document.body.innerHTML = MAIN;
  const sent = [];
  const runtime = {
    sendMessage: (msg) => {
      sent.push(msg);
      return Promise.resolve(respond(msg));
    },
  };
  const store = makeStorageFake({ initial, runtime });
  if (perms) store.browser.permissions = perms.api;
  const GA = loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/protocol.js",
      "src/core/backup.js",
      "src/core/quick-actions.js",
      "src/options/options.js",
    ],
    { browser: store.browser },
  );
  await settle();
  const el = (id) => document.getElementById(id);
  const saved = () => store.data["ga:settings"] || {};
  return { GA, store, sent, el, saved, perms };
}

function typeInto(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

function toggle(box) {
  box.click(); // flips checked and fires click + change, like a real click
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Use for research checkbox", () => {
  it("is disabled for rows without a key and enabled live once one is typed", async () => {
    const { el } = await setup({ initial: { "ga:settings": { openaiApiKey: "sk-1" } } });
    expect(el("openai-research").disabled).toBe(false);
    expect(el("gemini-research").disabled).toBe(true);
    expect(el("anthropic-research").disabled).toBe(true);
    expect(el("openrouter-research").disabled).toBe(true);
    typeInto(el("openrouter-key"), "sk-or");
    expect(el("openrouter-research").disabled).toBe(false);
    typeInto(el("openrouter-key"), "  ");
    expect(el("openrouter-research").disabled).toBe(true);
  });

  it("reflects the stored research provider on load", async () => {
    const { el } = await setup({
      initial: {
        "ga:settings": {
          anthropicApiKey: "sk-ant",
          openaiApiKey: "sk",
          researchProvider: "anthropic",
        },
      },
    });
    expect(el("anthropic-research").checked).toBe(true);
    expect(el("openai-research").checked).toBe(false);
  });

  it("is exclusive: checking one row unchecks the others; unchecking clears it", async () => {
    const { el, saved } = await setup({
      initial: { "ga:settings": { openaiApiKey: "sk", geminiApiKey: "AIza" } },
    });
    toggle(el("openai-research"));
    await settle();
    expect(saved().researchProvider).toBe("openai");
    toggle(el("gemini-research"));
    await settle();
    expect(saved().researchProvider).toBe("gemini");
    expect(el("gemini-research").checked).toBe(true);
    expect(el("openai-research").checked).toBe(false);
    toggle(el("gemini-research"));
    await settle();
    expect(saved().researchProvider).toBe("");
    expect(el("gemini-research").checked).toBe(false);
  });

  it("clearing the research row's key resets researchProvider and unchecks it", async () => {
    const { el, saved } = await setup({
      initial: { "ga:settings": { openrouterApiKey: "sk-or", researchProvider: "openrouter" } },
    });
    expect(el("openrouter-research").checked).toBe(true);
    typeInto(el("openrouter-key"), "");
    expect(el("openrouter-research").checked).toBe(false);
    expect(el("openrouter-research").disabled).toBe(true);
    await DEBOUNCE();
    expect(saved().researchProvider).toBe("");
    expect(saved().openrouterApiKey).toBe("");
  });

  it("clearing a different row's key leaves the research provider alone", async () => {
    const { el, saved } = await setup({
      initial: {
        "ga:settings": { openaiApiKey: "sk", geminiApiKey: "AIza", researchProvider: "openai" },
      },
    });
    typeInto(el("gemini-key"), "");
    await DEBOUNCE();
    expect(saved().researchProvider).toBe("openai");
    expect(el("openai-research").checked).toBe(true);
  });
});

describe("Research card: search engine", () => {
  it("the Brave key input shows only when Brave is selected, and the choice is saved", async () => {
    const { el, saved } = await setup();
    expect(el("search-provider").value).toBe("ddg");
    expect(el("search-key").hidden).toBe(true);
    expect(el("search-key").disabled).toBe(true);
    el("search-provider").value = "brave";
    el("search-provider").dispatchEvent(new Event("change"));
    await settle();
    expect(el("search-key").hidden).toBe(false);
    expect(el("search-key").disabled).toBe(false);
    expect(saved().searchProvider).toBe("brave");
    typeInto(el("search-key"), " BSA-key ");
    await DEBOUNCE();
    expect(saved().searchApiKey).toBe("BSA-key");
  });

  it("reflects a stored Brave setup on load", async () => {
    const { el } = await setup({
      initial: { "ga:settings": { searchProvider: "brave", searchApiKey: "BSA" } },
    });
    expect(el("search-provider").value).toBe("brave");
    expect(el("search-key").hidden).toBe(false);
    expect(el("search-key").value).toBe("BSA");
  });

  it("Test sends MSG_TEST_SEARCH and renders OK · N results · Xms", async () => {
    const { GA, el, sent } = await setup({ respond: () => ({ ok: true, count: 8, ms: 321 }) });
    el("search-test").click();
    await settle();
    expect(sent).toEqual([{ type: GA.protocol.MSG_TEST_SEARCH, provider: "ddg", key: "" }]);
    expect(el("search-test-status").textContent).toBe("OK · 8 results · 321ms");
    expect(el("search-test-status").classList.contains("ok")).toBe(true);
    expect(el("search-test").disabled).toBe(false);
  });

  it("Test with Brave sends the typed key and renders a failure message", async () => {
    const { el, sent } = await setup({
      respond: () => ({ ok: false, message: "Brave rejected the key (HTTP 401)." }),
    });
    el("search-provider").value = "brave";
    el("search-provider").dispatchEvent(new Event("change"));
    el("search-key").value = " BSA ";
    el("search-test").click();
    await settle();
    expect(sent[0]).toMatchObject({ type: "ga-test-search", provider: "brave", key: "BSA" });
    expect(el("search-test-status").textContent).toBe("Brave rejected the key (HTTP 401).");
    expect(el("search-test-status").classList.contains("bad")).toBe(true);
  });

  it("Brave without a key asks for one and sends nothing", async () => {
    const { el, sent } = await setup();
    el("search-provider").value = "brave";
    el("search-provider").dispatchEvent(new Event("change"));
    el("search-test").click();
    await settle();
    expect(sent).toHaveLength(0);
    expect(el("search-test-status").classList.contains("bad")).toBe(true);
  });
});

describe("Research card: read web pages permission", () => {
  const ALL = { origins: ["<all_urls>"] };

  it("reflects permissions.contains on load", async () => {
    const perms = makePerms({ granted: true });
    const { el } = await setup({ perms });
    expect(perms.api.contains).toHaveBeenCalledWith(ALL);
    expect(el("research-read-pages").checked).toBe(true);
  });

  it("ticking requests <all_urls> and keeps the grant", async () => {
    const perms = makePerms({ granted: false, requestResult: true });
    const { el, store } = await setup({ perms });
    expect(el("research-read-pages").checked).toBe(false);
    const setsBefore = store.setCalls.length;
    toggle(el("research-read-pages"));
    await settle();
    expect(perms.api.request).toHaveBeenCalledWith(ALL);
    expect(el("research-read-pages").checked).toBe(true);
    expect(store.setCalls).toHaveLength(setsBefore); // permission state, not a setting
  });

  it("a declined prompt leaves it unticked", async () => {
    const perms = makePerms({ granted: false, requestResult: false });
    const { el } = await setup({ perms });
    toggle(el("research-read-pages"));
    await settle();
    expect(perms.api.request).toHaveBeenCalledTimes(1);
    expect(el("research-read-pages").checked).toBe(false);
  });

  it("unticking removes the permission", async () => {
    const perms = makePerms({ granted: true });
    const { el } = await setup({ perms });
    toggle(el("research-read-pages"));
    await settle();
    expect(perms.api.remove).toHaveBeenCalledWith(ALL);
    expect(perms.granted).toBe(false);
    expect(el("research-read-pages").checked).toBe(false);
  });

  it("without browser.permissions the control is hidden and disabled", async () => {
    const { el } = await setup({ perms: null });
    expect(el("research-read-pages").disabled).toBe(true);
    expect(el("read-pages-block").hidden).toBe(true);
  });
});

describe("Research card: limits", () => {
  it("shows the schema defaults", async () => {
    const { el } = await setup();
    expect(el("research-max-steps").value).toBe("8");
    expect(el("research-max-searches").value).toBe("5");
    expect(el("research-max-pages").value).toBe("3");
  });

  it("saves edits, clamped to each range", async () => {
    const { el, saved } = await setup();
    const set = async (id, v) => {
      el(id).value = v;
      el(id).dispatchEvent(new Event("change"));
      await settle();
    };
    await set("research-max-steps", "12");
    expect(saved().researchMaxSteps).toBe(12);
    await set("research-max-steps", "40");
    expect(saved().researchMaxSteps).toBe(15);
    expect(el("research-max-steps").value).toBe("15");
    await set("research-max-steps", "1");
    expect(saved().researchMaxSteps).toBe(2);
    await set("research-max-searches", "-3");
    expect(saved().researchMaxSearches).toBe(0);
    await set("research-max-pages", "99");
    expect(saved().researchMaxPages).toBe(8);
    await set("research-max-pages", "");
    expect(saved().researchMaxPages).toBe(3); // empty falls back to the default
    expect(document.getElementById("research-status").textContent).toBe("Saved.");
  });

  it("clamps an out-of-range stored value on display", async () => {
    const { el } = await setup({ initial: { "ga:settings": { researchMaxPages: 50 } } });
    expect(el("research-max-pages").value).toBe("8");
  });
});
