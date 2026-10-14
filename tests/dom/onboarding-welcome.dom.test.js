// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadGA } from "../helpers/loadGA.js";
import { makeStorageFake } from "../helpers/storage-mock.js";

// Onboarding page script (A1): drives the REAL welcome.js against a fake
// browser.storage.local. welcome.js auto-inits only outside tests (loadGA
// injects `module`), so each spec builds its DOM, loads the script, then calls
// init() explicitly.

const SETTINGS = "ga:settings";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function setup({ initial = {} } = {}) {
  document.body.innerHTML = `
    <span id="shortcut-label"><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>H</kbd></span>
    <input type="password" id="openai-key" />
    <span id="key-status" role="status"></span>
    <button id="open-settings"></button>`;
  const calls = { openOptionsPage: 0 };
  const store = makeStorageFake({
    initial,
    runtime: {
      openOptionsPage() {
        calls.openOptionsPage++;
        return Promise.resolve();
      },
    },
  });
  const GA = loadGA(
    ["src/shared/settings-schema.js", "src/shared/copy.js", "src/onboarding/welcome.js"],
    {
      browser: store.browser,
    },
  );
  const el = (id) => document.getElementById(id);
  const type = (value) => {
    el("openai-key").value = value;
    el("openai-key").dispatchEvent(new Event("input"));
  };
  return { GA, store, calls, el, type };
}

describe("onboarding welcome page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefills the key field from stored settings", async () => {
    const { GA, el } = setup({ initial: { [SETTINGS]: { openaiApiKey: "sk-old" } } });
    await GA.onboarding.init();
    expect(el("openai-key").value).toBe("sk-old");
  });

  it("saves a typed key after the debounce, preserving every other setting", async () => {
    const { GA, store, el, type } = setup({
      initial: { [SETTINGS]: { openaiApiKey: "sk-old", anthropicApiKey: "keep-me" } },
    });
    await GA.onboarding.init();
    type("  sk-new  ");
    expect(store.data[SETTINGS].openaiApiKey).toBe("sk-old"); // not yet
    await vi.advanceTimersByTimeAsync(GA.onboarding.SAVE_DEBOUNCE_MS);
    expect(store.data[SETTINGS].openaiApiKey).toBe("sk-new"); // trimmed
    expect(store.data[SETTINGS].anthropicApiKey).toBe("keep-me");
    // defaults are filled in, so consumers of the bucket see a full object
    expect(store.data[SETTINGS].openaiModel).toBe(GA.schema.DEFAULT_SETTINGS.openaiModel);
    expect(el("key-status").textContent).toBe("Saved ✓");
  });

  it("re-reads storage at save time: a setting changed after init survives the save", async () => {
    const { GA, store, type } = setup({ initial: { [SETTINGS]: { scope: "section" } } });
    await GA.onboarding.init();
    type("sk-new");
    // simulate the options page (another tab) changing a setting mid-debounce
    store.data[SETTINGS].scope = "conversation";
    await vi.advanceTimersByTimeAsync(GA.onboarding.SAVE_DEBOUNCE_MS);
    expect(store.data[SETTINGS].scope).toBe("conversation");
    expect(store.data[SETTINGS].openaiApiKey).toBe("sk-new");
  });

  it("debounces: rapid typing produces one write, and new input clears the status", async () => {
    const { GA, store, el, type } = setup();
    await GA.onboarding.init();
    type("sk-a");
    await vi.advanceTimersByTimeAsync(GA.onboarding.SAVE_DEBOUNCE_MS - 100);
    type("sk-ab");
    await vi.advanceTimersByTimeAsync(GA.onboarding.SAVE_DEBOUNCE_MS);
    expect(store.setCalls.length).toBe(1);
    expect(store.data[SETTINGS].openaiApiKey).toBe("sk-ab");
    expect(el("key-status").textContent).toBe("Saved ✓");
    type("sk-abc");
    expect(el("key-status").textContent).toBe("");
  });

  it("renders the default shortcut into the step copy", async () => {
    const { GA, el } = setup();
    await GA.onboarding.init();
    expect(el("shortcut-label").textContent).toBe("Ctrl + Shift + H");
    expect(el("shortcut-label").querySelectorAll("kbd").length).toBe(3);
  });

  it("renders a rebound shortcut, merged over the default", async () => {
    const { GA, el } = setup({
      initial: { [SETTINGS]: { shortcut: { ctrl: false, alt: true, key: "k" } } },
    });
    await GA.onboarding.init();
    // shift stays true from the default shortcut — same merge as options.js
    expect(el("shortcut-label").textContent).toBe("Alt + Shift + K");
  });

  it("fills the trust line by the key field from the shared copy", async () => {
    const { GA } = setup();
    document.body.insertAdjacentHTML("beforeend", '<p id="tl" data-trust-line></p>');
    await GA.onboarding.init();
    expect(document.getElementById("tl").textContent).toBe(GA.copy.TRUST_LINE);
  });

  it("the shipped page has a trust-line slot and key + pricing links matching PROVIDER_LINKS", async () => {
    const html = fs.readFileSync(path.join(ROOT, "src/onboarding/welcome.html"), "utf8");
    document.body.innerHTML = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    const copy = (await import("../../src/shared/copy.js")).default;
    expect(document.querySelectorAll("[data-trust-line]").length).toBe(1);
    const links = copy.PROVIDER_LINKS.chatgpt;
    const key = document.getElementById("openai-key-link");
    const pricing = document.getElementById("openai-pricing-link");
    expect(key.getAttribute("href")).toBe(links.keyUrl);
    expect(pricing.getAttribute("href")).toBe(links.pricingUrl);
    expect(key.textContent).toBe("Get a key ↗");
    expect(pricing.textContent).toBe("Pricing ↗");
    for (const a of [key, pricing]) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
    }
  });

  it("the settings button opens the options page directly", async () => {
    const { GA, calls, el } = setup();
    await GA.onboarding.init();
    el("open-settings").click();
    expect(calls.openOptionsPage).toBe(1);
  });
});
