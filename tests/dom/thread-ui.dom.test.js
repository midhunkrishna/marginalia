// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// A destroyed box (torn down on conversation switch) must ignore late work from
// a still-running turn: no renders into detached nodes, no relayout requests,
// and no throws. (The turn itself keeps running — session pinning decides where
// it persists; this is only about the dead view.)

function makeGA() {
  return loadGA(
    [
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
      "src/content/undo-stack.js",
      "src/content/composer.js",
      "src/content/label-strip.js",
      "src/content/calm-scroll.js",
      "src/content/thread-ui.js",
    ],
    {
      // Deterministic sync animation frames for the streaming coalescer.
      requestAnimationFrame: (f) => (f(), 0),
      cancelAnimationFrame: () => {},
    },
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ThreadBox.destroy()", () => {
  it("late stream chunks and completion no longer touch the box", async () => {
    const GA = makeGA();
    let resolveAsk;
    let onChunk;
    let resizes = 0;
    const thread = { id: "t1", selector: { exact: "highlighted text" }, messages: [] };
    const box = GA.ThreadBox(thread, {
      ask: (t, opts) =>
        new Promise((res) => {
          resolveAsk = res;
          onChunk = opts.onChunk;
        }),
      persist: () => {},
      onResize: () => resizes++,
    });
    document.body.appendChild(box.el);

    box.el.querySelector(".ga-input").value = "why?";
    box.el.querySelector(".ga-send").click();
    await tick(); // let the turn reach ask()

    onChunk("partial");
    expect(box.el.querySelectorAll(".ga-msg")).toHaveLength(2); // user + model
    expect(box.el.querySelectorAll(".ga-msg")[1].textContent).toContain("partial");

    box.destroy();
    const resizesAtDestroy = resizes;

    expect(() => onChunk("partial plus more")).not.toThrow();
    resolveAsk("final answer");
    await tick(); // turn finishes (endModel, setLoading(false), persist)

    const model = box.el.querySelectorAll(".ga-msg")[1];
    expect(model.textContent).not.toContain("final"); // no render after destroy
    expect(box.el.classList.contains("ga-msg-streaming")).toBe(false);
    expect(resizes).toBe(resizesAtDestroy); // no relayout churn from the dead box
    expect(thread.messages.map((m) => m.role)).toEqual(["user", "model"]); // turn itself completed
  });

  it("Ctrl+Z restores the inline composer text after send; Ctrl+Shift+Z re-clears", () => {
    const GA = makeGA();
    const thread = { id: "tu", selector: { exact: "x" }, messages: [] };
    const box = GA.ThreadBox(thread, {
      ask: () => new Promise(() => {}), // never resolves — we only care about the clear
      persist: () => {},
    });
    document.body.appendChild(box.el);
    const ta = box.el.querySelector(".ga-input");

    ta.value = "bring me back";
    box.el.querySelector(".ga-send").click(); // submit clears the box
    expect(ta.value).toBe("");

    const e1 = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    ta.dispatchEvent(e1);
    expect(ta.value).toBe("bring me back");
    expect(e1.defaultPrevented).toBe(true);

    const e2 = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    ta.dispatchEvent(e2);
    expect(ta.value).toBe("");
  });

  it("Ctrl+Z on an empty inline composer stack does not preventDefault", () => {
    const GA = makeGA();
    const box = GA.ThreadBox(
      { id: "te", selector: { exact: "x" }, messages: [] },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    const ta = box.el.querySelector(".ga-input");
    const e = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    ta.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it("appendMessage on a destroyed box returns a handle without attaching it", () => {
    const GA = makeGA();
    const thread = { id: "t2", selector: { exact: "x" }, messages: [] };
    const box = GA.ThreadBox(thread, { persist: () => {} });
    document.body.appendChild(box.el);
    box.destroy();
    expect(box.el.isConnected).toBe(false);
    expect(box.el.querySelectorAll(".ga-msg")).toHaveLength(0);
  });
});

describe("draft handoff while collapsed", () => {
  it("takeDraft on a collapsed box never pins the textarea to 0px", () => {
    const GA = makeGA();
    const box = GA.ThreadBox(
      { id: "h1", selector: { exact: "x" }, messages: [] },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    const ta = box.el.querySelector(".ga-input");
    ta.style.height = "40px"; // a previously-fitted height

    // The wasCompact expand path: the composer is display:none when the
    // draft is taken, so fitTextarea measures scrollHeight 0 — the guard
    // must keep the prior height instead of writing 0px.
    box.setCollapsed(true, { persist: false });
    box.takeDraft();
    box.setCollapsed(false, { persist: false });
    expect(ta.style.height).toBe("40px");
  });
});

describe("height measurement (naturalHeight / chromeHeight)", () => {
  it("serves both values from one cached pass; invalidateHeight refreshes", () => {
    const GA = makeGA();
    const box = GA.ThreadBox(
      { id: "m1", selector: { exact: "x" }, messages: [] },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    const messagesEl = box.el.querySelector(".ga-messages");
    let offsetH = 300;
    let clientH = 150;
    let scrollH = 500;
    Object.defineProperty(box.el, "offsetHeight", { get: () => offsetH, configurable: true });
    Object.defineProperty(messagesEl, "clientHeight", { get: () => clientH, configurable: true });
    Object.defineProperty(messagesEl, "scrollHeight", { get: () => scrollH, configurable: true });
    box.invalidateHeight();

    expect(box.chromeHeight()).toBe(150); // offsetHeight - clientHeight
    expect(box.naturalHeight()).toBe(650); // chrome + scrollHeight

    // same cache: geometry changes are invisible until invalidated
    offsetH = 340; // composer grew 40px
    expect(box.chromeHeight()).toBe(150);
    expect(box.naturalHeight()).toBe(650);

    box.invalidateHeight();
    expect(box.chromeHeight()).toBe(190);
    expect(box.naturalHeight()).toBe(690);
  });
});

describe("lazy history rendering", () => {
  afterEach(() => {
    delete window.requestIdleCallback;
  });
  const messages = (n) =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 ? "model" : "user",
      text: "message " + i,
    }));

  it("a collapsed chip builds no message DOM until expanded, then shows everything", () => {
    const GA = makeGA();
    const box = GA.ThreadBox(
      { id: "l1", selector: { exact: "x" }, messages: messages(6), collapsed: true },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    box.naturalHeight(); // chip measurement — must NOT materialize history
    expect(box.el.querySelectorAll(".ga-msg")).toHaveLength(0);

    box.setCollapsed(false, { persist: false });
    const texts = Array.from(box.el.querySelectorAll(".ga-msg"), (m) => m.textContent);
    expect(texts).toEqual(messages(6).map((m) => m.text)); // full history, in order
  });

  it("an expanded box materializes at first measure; jsdom (zero heights) renders fully", () => {
    const GA = makeGA();
    const box = GA.ThreadBox(
      { id: "l2", selector: { exact: "x" }, messages: messages(4) },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    expect(box.el.querySelectorAll(".ga-msg")).toHaveLength(0); // constructor defers
    box.naturalHeight();
    expect(Array.from(box.el.querySelectorAll(".ga-msg"), (m) => m.textContent)).toEqual(
      messages(4).map((m) => m.text),
    );
  });

  it("stops at the viewport target and idle-fills the rest, oldest last, order intact", () => {
    const GA = makeGA();
    const idle = [];
    window.requestIdleCallback = (cb) => (idle.push(cb), idle.length);
    const box = GA.ThreadBox(
      { id: "l3", selector: { exact: "x" }, messages: messages(10) },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    const messagesEl = box.el.querySelector(".ga-messages");
    // grow scrollHeight with each rendered message so the sync loop stops
    Object.defineProperty(messagesEl, "scrollHeight", {
      get: () => messagesEl.querySelectorAll(".ga-msg").length * 300,
      configurable: true,
    });
    box.naturalHeight(); // 3 messages reach the 768px jsdom viewport target
    expect(messagesEl.querySelectorAll(".ga-msg")).toHaveLength(3);

    while (idle.length) idle.shift()(); // run idle batches
    expect(Array.from(messagesEl.querySelectorAll(".ga-msg"), (m) => m.textContent)).toEqual(
      messages(10).map((m) => m.text),
    ); // complete, correct order
  });

  it("scrolling near the top flushes the pending history synchronously", () => {
    const GA = makeGA();
    const idle = [];
    window.requestIdleCallback = (cb) => (idle.push(cb), idle.length);
    const box = GA.ThreadBox(
      { id: "l4", selector: { exact: "x" }, messages: messages(10) },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    const messagesEl = box.el.querySelector(".ga-messages");
    Object.defineProperty(messagesEl, "scrollHeight", {
      get: () => messagesEl.querySelectorAll(".ga-msg").length * 300,
      configurable: true,
    });
    box.naturalHeight();
    expect(messagesEl.querySelectorAll(".ga-msg").length).toBeLessThan(10);

    messagesEl.scrollTop = 0;
    messagesEl.dispatchEvent(new window.Event("scroll"));
    expect(messagesEl.querySelectorAll(".ga-msg")).toHaveLength(10); // flushed
  });

  it("refreshMessages resets the pending fill (no duplicates)", () => {
    const GA = makeGA();
    const idle = [];
    window.requestIdleCallback = (cb) => (idle.push(cb), idle.length);
    const box = GA.ThreadBox(
      { id: "l5", selector: { exact: "x" }, messages: messages(8) },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    const messagesEl = box.el.querySelector(".ga-messages");
    Object.defineProperty(messagesEl, "scrollHeight", {
      get: () => messagesEl.querySelectorAll(".ga-msg").length * 300,
      configurable: true,
    });
    box.naturalHeight(); // partial render, idle pending
    box.refreshMessages(); // full eager rebuild
    while (idle.length) idle.shift()(); // stale idle batches must be no-ops
    expect(messagesEl.querySelectorAll(".ga-msg")).toHaveLength(8);
  });
});

// The engine pins a bottom-heavy box's bottom edge, so stream growth must lift
// the top in the SAME frame as the DOM write — a scheduled relayout lands a
// frame late and the box sags into the bottom gap, then jerks back up.
describe("streaming drives a same-frame relayout", () => {
  function streamSetup(GA) {
    let onChunk;
    let resolveAsk;
    let box; // onResize can fire during construction, before the binding exists
    const events = [];
    const thread = { id: "s1", selector: { exact: "hl" }, messages: [] };
    box = GA.ThreadBox(thread, {
      ask: (t, opts) =>
        new Promise((res) => {
          resolveAsk = res;
          onChunk = opts.onChunk;
        }),
      persist: () => {},
      onResize: (opts) =>
        events.push({ kind: "resize", opts, natural: box ? box.naturalHeight() : null }),
    });
    document.body.appendChild(box.el);
    const messagesEl = box.el.querySelector(".ga-messages");
    const geo = { scrollH: 500 };
    Object.defineProperty(box.el, "offsetHeight", { get: () => 300, configurable: true });
    Object.defineProperty(messagesEl, "clientHeight", { get: () => 150, configurable: true });
    Object.defineProperty(messagesEl, "scrollHeight", {
      get: () => geo.scrollH,
      configurable: true,
    });
    Object.defineProperty(messagesEl, "scrollTop", {
      get: () => 0,
      set: () => {
        events.push({ kind: "scroll" });
      },
      configurable: true,
    });
    box.el.querySelector(".ga-input").value = "q";
    box.el.querySelector(".ga-send").click();
    return { box, events, geo, chunk: (t) => onChunk(t), finish: (t) => resolveAsk(t) };
  }

  it("a growth flush calls onResize({now:true}) with the fresh height, before the scroll", async () => {
    const GA = makeGA();
    const s = streamSetup(GA);
    await tick(); // turn reaches ask()
    s.chunk("first"); // model bubble + first flush (sync rAF stub)
    s.events.length = 0;

    s.geo.scrollH = 800; // this flush grows the content
    s.chunk("first plus a new line");
    expect(s.events.map((e) => e.kind)).toEqual(["resize", "scroll"]);
    expect(s.events[0].opts).toEqual({ now: true }); // same-frame request
    expect(s.events[0].natural).toBe(150 + 800); // cache refreshed BEFORE the resize fired
  });

  it("a flush that doesn't change the height skips the relayout", async () => {
    const GA = makeGA();
    const s = streamSetup(GA);
    await tick();
    s.chunk("first");
    s.events.length = 0;

    s.chunk("first!"); // same rendered height (scrollH unchanged)
    expect(s.events.filter((e) => e.kind === "resize")).toHaveLength(0);
    expect(s.events.filter((e) => e.kind === "scroll")).toHaveLength(1); // still follows
  });

  it("turn completion drives one final same-frame relayout on a live box", async () => {
    const GA = makeGA();
    const s = streamSetup(GA);
    await tick();
    s.chunk("partial");
    s.events.length = 0;

    s.finish("final answer");
    await tick(); // endModel -> renderFinal -> onEnd
    expect(s.events.some((e) => e.kind === "resize" && e.opts && e.opts.now === true)).toBe(true);
  });
});

// An empty thread (no conversation, nothing typed) deletes without the
// confirm popover; anything worth losing still asks first.
describe("delete confirmation", () => {
  function makeBox(GA, thread, onDelete) {
    const box = GA.ThreadBox(thread, { persist: () => {}, onDelete });
    document.body.appendChild(box.el);
    return box;
  }
  const trash = (box) => box.el.querySelector('.ga-iconbtn[title^="Delete thread"]');
  const popover = (box) => box.el.querySelector(".ga-confirm");

  it("an empty thread deletes immediately, no popover", () => {
    const GA = makeGA();
    const thread = { id: "d1", selector: { exact: "x" }, messages: [] };
    const onDelete = vi.fn();
    const box = makeBox(GA, thread, onDelete);
    trash(box).click();
    expect(popover(box).classList.contains("ga-confirm-show")).toBe(false);
    expect(onDelete).toHaveBeenCalledWith(thread);
  });

  it("a thread with a conversation asks first; Yes deletes", () => {
    const GA = makeGA();
    const thread = {
      id: "d2",
      selector: { exact: "x" },
      messages: [{ role: "user", text: "earlier question" }],
    };
    const onDelete = vi.fn();
    const box = makeBox(GA, thread, onDelete);
    trash(box).click();
    expect(popover(box).classList.contains("ga-confirm-show")).toBe(true);
    expect(onDelete).not.toHaveBeenCalled();
    box.el.querySelector(".ga-confirm-yes").click();
    expect(onDelete).toHaveBeenCalledWith(thread);
  });

  it("a typed-but-unsent draft still gets the confirmation", () => {
    const GA = makeGA();
    const thread = { id: "d3", selector: { exact: "x" }, messages: [] };
    const onDelete = vi.fn();
    const box = makeBox(GA, thread, onDelete);
    box.el.querySelector(".ga-input").value = "typed but not sent";
    trash(box).click();
    expect(popover(box).classList.contains("ga-confirm-show")).toBe(true);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("Del key on an empty focused box deletes immediately", () => {
    const GA = makeGA();
    const thread = { id: "d4", selector: { exact: "x" }, messages: [] };
    const onDelete = vi.fn();
    const box = makeBox(GA, thread, onDelete);
    box.el.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(onDelete).toHaveBeenCalledWith(thread);
  });
});

// ---- research mode ---------------------------------------------------------
function makeResearchGA() {
  const GA = loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/config.js",
      "src/core/sites.js",
      "src/core/labels.js",
      "src/core/citations.js",
      "src/core/markdown-ast.js",
      "src/content/util.js",
      "src/content/icons.js",
      "src/content/ui-bits.js",
      "src/content/markdown.js",
      "src/content/thread-turn.js",
      "src/content/stream-view.js",
      "src/content/undo-stack.js",
      "src/content/composer.js",
      "src/content/label-strip.js",
      "src/content/calm-scroll.js",
      "src/content/thread-ui.js",
    ],
    { requestAnimationFrame: (f) => (f(), 0), cancelAnimationFrame: () => {} },
  );
  GA.provider = "gemini";
  GA.settings = { researchProvider: "anthropic", anthropicApiKey: "k", anthropicModel: "m" };
  return GA;
}

const SRC = [{ n: 1, title: "One", url: "https://one.example/a" }];

describe("ThreadBox research rendering", () => {
  it("a stored research reply shows the chip and linked citations", () => {
    const GA = makeResearchGA();
    const thread = {
      id: "t1",
      selector: { exact: "x" },
      messages: [
        { role: "user", text: "q", research: true, provider: "claude" },
        {
          role: "model",
          text: "Fact [1].\n\n---\nSources\n[1] One — https://one.example/a",
          provider: "claude",
          research: { model: "m", sources: SRC },
        },
      ],
    };
    const box = GA.ThreadBox(thread, { ask: vi.fn(), persist: vi.fn() });
    document.body.appendChild(box.el);
    box.refreshMessages();
    const model = box.el.querySelector(".ga-msg-model");
    expect(model.querySelector(".ga-msg-research").textContent).toBe("Research via Claude");
    expect(model.querySelector(".ga-msg-via")).toBeNull(); // the chip carries provenance
    const link = [...model.querySelectorAll("a")].find((a) => a.textContent === "1");
    expect(link.getAttribute("href")).toBe("https://one.example/a");
    expect(link.target).toBe("_blank");
  });

  it("the research chip has no 'via' when the research provider is the site's own", () => {
    const GA = makeResearchGA();
    GA.provider = "claude";
    const thread = {
      id: "t1",
      selector: { exact: "x" },
      messages: [{ role: "model", text: "a", provider: "claude", research: { sources: [] } }],
    };
    const box = GA.ThreadBox(thread, { ask: vi.fn(), persist: vi.fn() });
    document.body.appendChild(box.el);
    box.refreshMessages();
    expect(box.el.querySelector(".ga-msg-research").textContent).toBe("Research");
  });

  it("a live research turn shows one status line per step, removed when the answer settles", async () => {
    const GA = makeResearchGA();
    let opts;
    let resolveAsk;
    const thread = { id: "t1", selector: { exact: "x" }, messages: [] };
    const box = GA.ThreadBox(thread, {
      ask: (t, o) =>
        new Promise((res) => {
          opts = o;
          resolveAsk = res;
        }),
      persist: vi.fn(),
    });
    document.body.appendChild(box.el);
    box.el.querySelector(".ga-research-btn").click();
    box.el.querySelector(".ga-input").value = "is it true?";
    box.el.querySelector(".ga-send").click();
    await tick();

    expect(opts).toMatchObject({ research: true, provider: "claude" });
    const bubble = box.el.querySelector(".ga-msg-streaming");
    expect(bubble.querySelector(".ga-msg-research")).toBeTruthy();

    const status = () => bubble.querySelectorAll(".ga-research-status");
    const texts = [];
    [
      { kind: "step", step: 1, maxSteps: 8 },
      { kind: "search", step: 1, query: "claim" },
      { kind: "results", step: 1, query: "claim", count: 5, sources: [] },
      { kind: "read", step: 2, n: 1, url: "https://one.example/a" },
      { kind: "read-done", step: 2, n: 1, title: "One", chars: 900 },
      { kind: "tool-error", step: 2, tool: "read_page", message: "timeout" },
      { kind: "final", step: 3 },
    ].forEach((st) => {
      opts.onStep(st);
      expect(status()).toHaveLength(1);
      texts.push(status()[0].textContent);
    });
    expect(texts).toEqual([
      "Step 1 of 8",
      "Searching: claim",
      "Found 5 results",
      "Reading: https://one.example/a",
      "Read: One",
      "read_page failed: timeout",
      "Writing answer…",
    ]);
    opts.onStep({ kind: "note", step: 3, text: "Let me check" });
    expect(status()[0].classList.contains("ga-research-note")).toBe(true);
    expect(status()[0].textContent).toBe("Let me check");

    opts.onChunk("Yes [1].");
    resolveAsk({ text: "Yes [1].", research: { model: "m", sources: SRC } });
    await tick();

    expect(bubble.querySelector(".ga-research-status")).toBeNull();
    expect(bubble.classList.contains("ga-msg-streaming")).toBe(false);
    const link = [...bubble.querySelectorAll("a")].find((a) => a.textContent === "1");
    expect(link.getAttribute("href")).toBe("https://one.example/a");
    expect(thread.messages[1]).toMatchObject({ research: { model: "m", sources: SRC } });
  });
});
