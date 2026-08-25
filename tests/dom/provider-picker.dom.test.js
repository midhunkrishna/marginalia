// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Issue #8 — the composer's "Answer with" picker and the provenance it
// leaves behind: per-reply "via X" tags in the box and modal, the box header
// badge, and the panel row pill. Missing provider = the site's own.

const COMMON = [
  "src/shared/settings-schema.js",
  "src/shared/config.js",
  "src/core/sites.js",
  "src/core/labels.js",
  "src/core/markdown-ast.js",
  "src/content/util.js",
  "src/content/icons.js",
  "src/content/ui-bits.js",
  "src/content/markdown.js",
  "src/content/thread-turn.js",
  "src/content/stream-view.js",
  "src/content/dialog.js",
  "src/content/undo-stack.js",
  "src/content/composer.js",
  "src/content/label-strip.js",
  "src/content/calm-scroll.js",
];

function makeGA(extraFiles, settings) {
  const GA = loadGA(COMMON.concat(extraFiles), {
    requestAnimationFrame: (f) => (f(), 0),
    cancelAnimationFrame: () => {},
  });
  GA.provider = "claude";
  GA.settings = Object.assign({}, settings || {});
  return GA;
}

afterEach(() => {
  document.body.innerHTML = "";
});

const TWO = { geminiApiKey: "g", geminiModel: "gemini-2.5-flash" };

describe("GA.Composer provider picker", () => {
  it("is absent when only the site's own provider is available", () => {
    const GA = makeGA([]);
    const c = GA.Composer({ providers: GA.core.sites.askOptions("claude", {}), onSubmit() {} });
    expect(c.el.querySelector(".ga-provider-select")).toBeNull();
  });

  it("lists site first, defaults to it, and submits without `provider`", () => {
    const GA = makeGA([]);
    const sent = [];
    const c = GA.Composer({
      providers: GA.core.sites.askOptions("claude", TWO),
      onSubmit: (t, o) => sent.push(o),
    });
    const sel = c.el.querySelector(".ga-provider-select");
    expect(sel.getAttribute("aria-label")).toBe("Answer with");
    expect([...sel.options].map((o) => o.textContent)).toEqual([
      "Claude (this site)",
      "Gemini · gemini-2.5-flash",
    ]);
    expect(sel.value).toBe("claude");
    expect(c.el.querySelector(".ga-provider-chev svg")).not.toBeNull();
    c.textarea.value = "q";
    c.el.querySelector(".ga-send").click();
    expect(sent).toEqual([{ md: false }]);
  });

  it("a non-site pick travels with the message and becomes the session default", () => {
    const GA = makeGA([]);
    const providers = GA.core.sites.askOptions("claude", TWO);
    const sent = [];
    const c = GA.Composer({ providers, onSubmit: (t, o) => sent.push(o) });
    const sel = c.el.querySelector(".ga-provider-select");
    sel.value = "gemini";
    sel.dispatchEvent(new window.Event("change"));
    c.textarea.value = "q";
    c.el.querySelector(".ga-send").click();
    expect(sent).toEqual([{ md: false, provider: "gemini" }]);

    // The next composer in this page session opens on the last pick…
    const c2 = GA.Composer({ providers, onSubmit() {} });
    expect(c2.el.querySelector(".ga-provider-select").value).toBe("gemini");
    // …unless that provider is no longer available (key removed).
    const c3 = GA.Composer({ providers: GA.core.sites.askOptions("claude", {}), onSubmit() {} });
    expect(c3.el.querySelector(".ga-provider-select")).toBeNull();
  });
});

describe("provenance: box, modal, panel", () => {
  const thread = (messages) => ({ id: "t1", selector: { exact: "hl" }, messages });

  it("ThreadBox tags cross-provider replies and shows the header badge", async () => {
    const GA = makeGA(["src/content/thread-ui.js"], TWO);
    const box = GA.ThreadBox(
      thread([
        { role: "user", text: "q" },
        { role: "model", text: "site" },
        { role: "user", text: "q2", provider: "gemini" },
        { role: "model", text: "<b>x</b>", provider: "gemini" },
      ]),
      { ask: vi.fn(async () => ""), persist: vi.fn() },
    );
    document.body.appendChild(box.el);
    box.refreshMessages();
    const tags = box.el.querySelectorAll(".ga-msg-via");
    expect(tags.length).toBe(1);
    expect(tags[0].textContent).toBe("via Gemini");
    expect(tags[0].parentElement.querySelector("b")).toBeNull(); // textContent only
    const badge = box.el.querySelector(".ga-box-via");
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("via Gemini");
    expect(box.el.querySelector(".ga-provider-select")).not.toBeNull();
  });

  it("ThreadBox hides the badge on a plain thread and shows no picker with one provider", () => {
    const GA = makeGA(["src/content/thread-ui.js"]);
    const box = GA.ThreadBox(
      thread([
        { role: "user", text: "q" },
        { role: "model", text: "a" },
      ]),
      {
        ask: vi.fn(async () => ""),
        persist: vi.fn(),
      },
    );
    document.body.appendChild(box.el);
    box.refreshMessages();
    expect(box.el.querySelector(".ga-msg-via")).toBeNull();
    expect(box.el.querySelector(".ga-box-via").hidden).toBe(true);
    expect(box.el.querySelector(".ga-provider-select")).toBeNull();
  });

  it("a live cross-provider turn stamps the reply and raises the badge", async () => {
    const GA = makeGA(["src/content/thread-ui.js"], TWO);
    const t = thread([]);
    const ask = vi.fn(async (_t, o) => "answer from " + o.provider);
    const box = GA.ThreadBox(t, { ask, persist: vi.fn() });
    document.body.appendChild(box.el);
    const sel = box.el.querySelector(".ga-provider-select");
    sel.value = "gemini";
    sel.dispatchEvent(new window.Event("change"));
    box.el.querySelector(".ga-input").value = "cheap opinion?";
    box.el.querySelector(".ga-send").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(ask.mock.calls[0][1].provider).toBe("gemini");
    expect(t.messages[1]).toMatchObject({ role: "model", provider: "gemini" });
    expect(box.el.querySelector(".ga-box-via").hidden).toBe(false);
    expect(box.el.querySelectorAll(".ga-msg-via").length).toBe(1);
  });

  it("Modal tags cross-provider replies", () => {
    const GA = makeGA(["src/content/modal.js"], TWO);
    GA.Modal.open(
      thread([
        { role: "model", text: "site" },
        { role: "model", text: "other", provider: "chatgpt" },
      ]),
      { ask: vi.fn(async () => ""), persist: vi.fn() },
      null,
    );
    const tags = document.querySelectorAll(".ga-modal .ga-msg-via");
    expect([...tags].map((e) => e.textContent)).toEqual(["via ChatGPT"]);
    expect(document.querySelector(".ga-modal .ga-provider-select")).not.toBeNull();
  });

  it("panel rows carry a via pill when any reply came from another provider", () => {
    const GA = loadGA(
      [
        "src/shared/settings-schema.js",
        "src/shared/config.js",
        "src/core/sites.js",
        "src/core/markdown-ast.js",
        "src/core/thread-search.js",
        "src/core/global-search.js",
        "src/core/turn-id.js",
        "src/core/outline.js",
        "src/content/util.js",
        "src/content/icons.js",
        "src/content/ui-bits.js",
        "src/content/dialog.js",
        "src/content/undo-stack.js",
        "src/content/composer.js",
        "src/content/calm-scroll.js",
        "src/content/panel-global.js",
        "src/content/panel.js",
      ],
      { location: { assign() {}, href: "https://claude.ai/chat/abc", pathname: "/chat/abc" } },
    );
    GA.provider = "claude";
    GA.settings = {};
    const threads = [
      thread([
        { role: "user", text: "q" },
        { role: "model", text: "a", provider: "gemini" },
      ]),
      Object.assign(
        thread([
          { role: "user", text: "q" },
          { role: "model", text: "a" },
        ]),
        { id: "t2" },
      ),
    ];
    GA.threadController = { threads: () => threads, expandThreadById() {} };
    GA.selection = { anchorEl: () => null };
    GA.gutter = { get: () => null, setActive() {}, mode: () => "normal" };
    GA.getSessionId = () => "claude:abc";
    GA.store = { loadConvo: async () => null, listThreadBuckets: async () => [] };
    GA.turns = { findTurns: () => [], fingerprintOf: () => null, textOf: () => "" };
    GA.panel.open();
    const rows = document.querySelectorAll(".ga-panel-row");
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector(".ga-panel-via").textContent).toBe("via Gemini");
    expect(rows[1].querySelector(".ga-panel-via")).toBeNull();
  });
});
