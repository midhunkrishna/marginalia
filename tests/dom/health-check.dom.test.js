// @vitest-environment jsdom
//
// Selector-health watcher against REAL captured markup. Intact selectors must
// stay silent; mangled ones (a simulated site redesign) must produce exactly
// one dismissible toast per session per site, with a prefilled report link.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadGA } from "../helpers/loadGA.js";

const fixture = (name) => readFileSync(resolve(__dirname, "../fixtures", name), "utf8");

const SITES = {
  gemini: { file: "gemini-conversation.html", path: "/app/abc123" },
  chatgpt: { file: "chatgpt-conversation.html", path: "/c/abc123" },
  claude: { file: "claude-conversation.html", path: "/chat/abc123" },
};

const THRESHOLD = 10000;

function mount(provider, { path } = {}) {
  document.body.innerHTML = fixture(SITES[provider].file);
  history.replaceState({}, "", path || SITES[provider].path);
  const GA = loadGA([
    "src/shared/settings-schema.js",
    "src/shared/config.js",
    "src/core/sites.js",
    "src/core/selector-health.js",
    "src/content/util.js",
    "src/content/health-check.js",
  ]);
  GA.provider = provider;
  return GA;
}

/** Rename every selector tier of a provider so none of them match the page. */
function mangle(GA, provider) {
  const def = GA.core.sites.PROVIDERS[provider];
  def.responseSelectors = def.responseSelectors.map(() => ".nope-response");
  def.turns = { user: [".nope-user"], model: [".nope-model"] };
}

const toasts = () => document.querySelectorAll(".ga-sticky-toast");

describe("healthCheck.watch — real markup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    document.documentElement.removeAttribute("data-ga-health");
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  for (const provider of Object.keys(SITES)) {
    it(provider + ": intact selectors never toast", () => {
      const GA = mount(provider);
      GA.healthCheck.watch().restart();
      vi.advanceTimersByTime(THRESHOLD * 3);
      expect(toasts().length).toBe(0);
    });

    it(provider + ": mangled selectors toast exactly once after the threshold", () => {
      const GA = mount(provider);
      mangle(GA, provider);
      GA.healthCheck.watch().restart();
      vi.advanceTimersByTime(THRESHOLD - GA.config.HEALTH_POLL_MS);
      expect(toasts().length).toBe(0); // still inside the hydration grace period
      vi.advanceTimersByTime(THRESHOLD * 3);
      expect(toasts().length).toBe(1);
    });
  }

  it("toast carries the update hint and a prefilled report link with site + tier + version", () => {
    const GA = mount("chatgpt");
    mangle(GA, "chatgpt");
    GA.healthCheck.watch().restart();
    vi.advanceTimersByTime(THRESHOLD * 2);
    const t = toasts()[0];
    expect(t.textContent).toMatch(/can't find answers/);
    expect(t.textContent).toMatch(/extension update/);
    const a = t.querySelector("a");
    expect(a.textContent).toBe("Report it");
    expect(a.target).toBe("_blank");
    const url = new URL(a.href);
    expect(url.pathname).toBe("/midhunkrishna/marginalia/issues/new");
    expect(url.searchParams.get("body")).toMatch(/chatgpt/);
    expect(url.searchParams.get("body")).toMatch(/all/);
  });

  it("reports which tier failed: answers gone, questions intact", () => {
    const GA = mount("gemini");
    GA.core.sites.PROVIDERS.gemini.turns.model = [".nope-model"];
    GA.core.sites.PROVIDERS.gemini.responseSelectors = [".nope-response"];
    GA.healthCheck.watch().restart();
    vi.advanceTimersByTime(THRESHOLD * 2);
    const url = new URL(toasts()[0].querySelector("a").href);
    expect(url.searchParams.get("title")).toMatch(/model/);
  });

  it("dismissing removes the toast and it does not come back", () => {
    const GA = mount("claude");
    mangle(GA, "claude");
    const watcher = GA.healthCheck.watch();
    watcher.restart();
    vi.advanceTimersByTime(THRESHOLD * 2);
    toasts()[0].querySelector("button").click();
    expect(toasts().length).toBe(0);
    watcher.restart();
    vi.advanceTimersByTime(THRESHOLD * 3);
    expect(toasts().length).toBe(0);
  });

  it("is once per session per site, even across a fresh load of the script", () => {
    const first = mount("claude");
    mangle(first, "claude");
    first.healthCheck.watch().restart();
    vi.advanceTimersByTime(THRESHOLD * 2);
    expect(toasts().length).toBe(1);
    expect(sessionStorage.getItem("ga:health:claude")).toBeTruthy();

    document.querySelector(".ga-sticky-toast").remove();
    const second = mount("claude"); // content script reloaded in the same tab session
    mangle(second, "claude");
    second.healthCheck.watch().restart();
    vi.advanceTimersByTime(THRESHOLD * 3);
    expect(toasts().length).toBe(0);
  });

  it("does not toast on a new chat (no conversation id) even with nothing matching", () => {
    const GA = mount("claude", { path: "/new" });
    mangle(GA, "claude");
    GA.healthCheck.watch().restart();
    vi.advanceTimersByTime(THRESHOLD * 3);
    expect(toasts().length).toBe(0);
  });

  it("does not toast when content hydrates inside the grace period", () => {
    const GA = mount("claude");
    const html = document.body.innerHTML;
    document.body.innerHTML = ""; // slow load: nothing there yet
    GA.healthCheck.watch().restart();
    vi.advanceTimersByTime(THRESHOLD / 2);
    document.body.innerHTML = html; // hydrates before the threshold
    vi.advanceTimersByTime(THRESHOLD * 3);
    expect(toasts().length).toBe(0);
  });

  it("holds the clock while the tab is hidden", () => {
    const GA = mount("claude");
    mangle(GA, "claude");
    let hidden = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    try {
      GA.healthCheck.watch().restart();
      vi.advanceTimersByTime(THRESHOLD * 3); // background tab: throttled hydration
      expect(toasts().length).toBe(0);
      hidden = false;
      vi.advanceTimersByTime(THRESHOLD * 2);
      expect(toasts().length).toBe(1);
    } finally {
      delete document.hidden;
    }
  });

  it("restart on a route change re-arms the clock for the new conversation", () => {
    const GA = mount("claude", { path: "/new" });
    mangle(GA, "claude");
    const watcher = GA.healthCheck.watch();
    watcher.restart();
    vi.advanceTimersByTime(THRESHOLD * 2);
    expect(toasts().length).toBe(0);
    history.replaceState({}, "", "/chat/xyz");
    watcher.restart();
    vi.advanceTimersByTime(THRESHOLD - GA.config.HEALTH_POLL_MS);
    expect(toasts().length).toBe(0);
    vi.advanceTimersByTime(THRESHOLD);
    expect(toasts().length).toBe(1);
  });

  it("debug mode records the verdict in data-ga-health; off by default", () => {
    const GA = mount("claude");
    mangle(GA, "claude");
    GA.healthCheck.watch().restart();
    vi.advanceTimersByTime(THRESHOLD * 2);
    expect(document.documentElement.hasAttribute("data-ga-health")).toBe(false);

    sessionStorage.clear();
    document.querySelector(".ga-sticky-toast").remove();
    const dbg = mount("claude");
    mangle(dbg, "claude");
    dbg.settings.debug = true;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    dbg.healthCheck.watch().restart();
    vi.advanceTimersByTime(THRESHOLD * 2);
    expect(document.documentElement.getAttribute("data-ga-health")).toBe("broken:all");
    expect(log.mock.calls.flat().join(" ")).toMatch(/all/);
    log.mockRestore();
  });
});

describe("GA.toast — sticky mode", () => {
  it("plain toasts keep auto-hiding and do not disturb a sticky one", () => {
    vi.useFakeTimers();
    const GA = mount("claude");
    GA.toast("Heads up", { sticky: true, link: { text: "More", href: "https://example.com/" } });
    GA.toast("Copied");
    vi.advanceTimersByTime(GA.config.TOAST_MS + 10);
    expect(document.querySelector(".ga-toast").classList.contains("ga-toast-show")).toBe(false);
    expect(document.querySelectorAll(".ga-sticky-toast").length).toBe(1);
    vi.useRealTimers();
  });

  it("calls onDismiss when the close button is clicked", () => {
    const GA = mount("claude");
    const onDismiss = vi.fn();
    GA.toast("x", { sticky: true, onDismiss });
    document.querySelector(".ga-sticky-toast-close").click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".ga-sticky-toast")).toBeNull();
  });
});
