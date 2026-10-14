import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Context-menu click on a page where the content script never ran (managed
// profile blocking injection, site access "on click", tab opened before
// install). tabs.sendMessage rejects there; background.js must surface that
// via ONE help tab (src/onboarding/blocked.html?host=…), throttled so a user
// who keeps clicking doesn't get a pile of tabs, and stay silent when the
// content script answered.

const TAB = { id: 7, url: "https://gemini.google.com/app/abc123" };
const CLICK = { menuItemId: "ga-ask", pageUrl: TAB.url };

function loadBackground({ sendMessage }) {
  const onClicked = [];
  const creates = [];
  const sent = [];
  const browser = {
    runtime: {
      id: "ext-id",
      getURL: (p) => "moz-extension://x/" + p,
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onConnect: { addListener() {} },
      onMessage: { addListener() {} },
    },
    contextMenus: {
      removeAll: () => Promise.resolve(),
      create() {},
      onClicked: {
        addListener(fn) {
          onClicked.push(fn);
        },
      },
    },
    tabs: {
      sendMessage(id, msg) {
        sent.push([id, msg]);
        return sendMessage();
      },
      create(opts) {
        creates.push(opts);
        return Promise.resolve({});
      },
    },
    scripting: { executeScript: () => Promise.resolve([{ result: {} }]) },
    storage: { local: { get: () => Promise.resolve({}) } },
  };
  const GA = loadGA(
    [
      "src/shared/protocol.js",
      "src/shared/hosts.js",
      "src/shared/config.js",
      "src/background/injection-guard.js",
      "src/background.js",
    ],
    { browser },
  );
  const click = (info = CLICK, tab = TAB) => onClicked.forEach((fn) => fn(info, tab));
  return { GA, creates, sent, click };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const dead = () => Promise.reject(new Error("Could not establish connection."));

afterEach(() => vi.restoreAllMocks());

describe("background context-menu click", () => {
  it("forwards the click to the content script", async () => {
    const { GA, sent, click } = loadBackground({ sendMessage: () => Promise.resolve() });
    click();
    await flush();
    expect(sent).toEqual([[7, { type: GA.protocol.MSG_OPEN_FROM_CONTEXT }]]);
  });

  it("opens the blocked-injection help tab once, carrying the host, when sendMessage rejects", async () => {
    const { creates, click } = loadBackground({ sendMessage: dead });
    click();
    await flush();
    expect(creates).toEqual([
      { url: "moz-extension://x/src/onboarding/blocked.html?host=gemini.google.com" },
    ]);
  });

  it("opens no tab when the content script answers", async () => {
    const { creates, click } = loadBackground({ sendMessage: () => Promise.resolve() });
    click();
    await flush();
    expect(creates).toEqual([]);
  });

  it("ignores clicks on other menu items", async () => {
    const { sent, creates, click } = loadBackground({ sendMessage: dead });
    click({ menuItemId: "something-else" });
    await flush();
    expect(sent).toEqual([]);
    expect(creates).toEqual([]);
  });

  it("throttles: repeated dead clicks inside the window spawn one tab, a later one spawns another", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { GA, creates, click } = loadBackground({ sendMessage: dead });
    click();
    await flush();
    now += 1000;
    click();
    await flush();
    expect(creates.length).toBe(1);
    now += GA.injectionGuard.THROTTLE_MS;
    click();
    await flush();
    expect(creates.length).toBe(2);
  });

  it("falls back to info.pageUrl when the tab carries no url", async () => {
    const { creates, click } = loadBackground({ sendMessage: dead });
    click({ ...CLICK, pageUrl: "https://claude.ai/chat/x" }, { id: 7 });
    await flush();
    expect(creates[0].url).toContain("host=claude.ai");
  });
});

describe("injectionGuard pure helpers", () => {
  const load = () => loadGA(["src/background/injection-guard.js"], { browser: {} }).injectionGuard;

  it("shouldShowBlockedHelp: true for a fresh http(s) page, false inside the throttle window", () => {
    const g = load();
    expect(g.shouldShowBlockedHelp("https://claude.ai/chat/1", 5000, null)).toBe(true);
    expect(g.shouldShowBlockedHelp("https://claude.ai/chat/1", 5000, 5000 - 1)).toBe(false);
    expect(g.shouldShowBlockedHelp("https://claude.ai/chat/1", 5000 + g.THROTTLE_MS, 5000)).toBe(
      true,
    );
  });

  it("shouldShowBlockedHelp: false when there is no usable page host", () => {
    const g = load();
    expect(g.shouldShowBlockedHelp(undefined, 5000, null)).toBe(false);
    expect(g.shouldShowBlockedHelp("not a url", 5000, null)).toBe(false);
    expect(g.shouldShowBlockedHelp("about:blank", 5000, null)).toBe(false);
  });

  it("buildHelpUrl: percent-encodes the host into the query string", () => {
    const g = load();
    expect(g.buildHelpUrl("x://e/blocked.html", "https://claude.ai/chat/1")).toBe(
      "x://e/blocked.html?host=claude.ai",
    );
    expect(g.hostOf("https://a.example/p?q=1#h")).toBe("a.example");
    expect(g.hostOf("garbage")).toBe("");
  });
});
