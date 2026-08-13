import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Context-menu dead-click detection (gh #19): the menu only exists on matched
// hosts, so a sendMessage rejection means the content script was blocked from
// injecting. The click must open the blocked-page guidance instead of being
// swallowed.

function loadBackground({ sendRejects } = {}) {
  let onClicked = null;
  const calls = { tabsCreate: 0, sendMessage: 0 };
  const browser = {
    runtime: {
      id: "ext-id",
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onConnect: { addListener() {} },
      onMessage: { addListener() {} },
      getURL: (p) => "moz-extension://ext/" + p,
    },
    contextMenus: {
      removeAll: () => Promise.resolve(),
      create() {},
      onClicked: {
        addListener(fn) {
          onClicked = fn;
        },
      },
    },
    tabs: {
      sendMessage() {
        calls.sendMessage++;
        return sendRejects
          ? Promise.reject(new Error("Could not establish connection."))
          : Promise.resolve();
      },
      create() {
        calls.tabsCreate++;
        return Promise.resolve({});
      },
    },
    scripting: { executeScript: () => Promise.resolve([{ result: {} }]) },
    storage: { local: { get: () => Promise.resolve({}) } },
  };
  const GA = loadGA(
    ["src/shared/protocol.js", "src/shared/hosts.js", "src/shared/config.js", "src/background.js"],
    { browser },
  );
  return { GA, calls, click: onClicked };
}

describe("context-menu dead-click detection", () => {
  it("a live content script receives the open message and opens no guidance page", async () => {
    const { calls, click } = loadBackground({ sendRejects: false });
    click({ menuItemId: "ga-ask" }, { id: 7 });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.sendMessage).toBe(1);
    expect(calls.tabsCreate).toBe(0);
  });

  it("a blocked content script (sendMessage rejection) opens the blocked guidance page", async () => {
    const { calls, click } = loadBackground({ sendRejects: true });
    click({ menuItemId: "ga-ask" }, { id: 7 });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.sendMessage).toBe(1);
    expect(calls.tabsCreate).toBe(1);
  });

  it("ignores other menu items and clicks without a tab", async () => {
    const { calls, click } = loadBackground({ sendRejects: true });
    click({ menuItemId: "other" }, { id: 7 });
    click({ menuItemId: "ga-ask" }, null);
    await Promise.resolve();
    expect(calls.sendMessage).toBe(0);
    expect(calls.tabsCreate).toBe(0);
  });
});
