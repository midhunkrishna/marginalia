// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Composer-local undo (GA.attachComposerUndo wired through GA.Composer): the
// clear-on-send must be reversible with Ctrl/Cmd+Z, and re-doable with
// Ctrl+Shift+Z, without disturbing Enter-to-send or native undo when idle.

function makeGA() {
  return loadGA([
    "src/shared/settings-schema.js",
    "src/shared/config.js",
    "src/core/sites.js",
    "src/content/util.js",
    "src/content/icons.js",
    "src/content/undo-stack.js",
    "src/content/composer.js",
  ]);
}

afterEach(() => {
  document.body.innerHTML = "";
});

function key(target, k, mods = {}) {
  const e = new window.KeyboardEvent("keydown", {
    key: k,
    bubbles: true,
    cancelable: true,
    ...mods,
  });
  target.dispatchEvent(e);
  return e;
}

describe("GA.Composer undo", () => {
  it("Ctrl+Z restores sent text and re-runs autosize; Ctrl+Shift+Z re-clears", () => {
    const GA = makeGA();
    let fitCalls = 0;
    const origFit = GA.fitTextarea;
    GA.fitTextarea = (ta) => (fitCalls++, origFit(ta));

    const sent = [];
    const c = GA.Composer({ onSubmit: (t) => sent.push(t) });
    document.body.appendChild(c.el);
    const ta = c.textarea;

    ta.value = "restore me";
    ta.dispatchEvent(new window.Event("input", { bubbles: true }));

    c.el.querySelector(".ga-send").click(); // submit clears the box
    expect(ta.value).toBe("");
    expect(sent).toEqual(["restore me"]);

    const before = fitCalls;
    const e1 = key(ta, "z", { ctrlKey: true });
    expect(ta.value).toBe("restore me"); // undo brought the text back
    expect(e1.defaultPrevented).toBe(true);
    expect(fitCalls).toBeGreaterThan(before); // autosize re-ran on restore

    const e2 = key(ta, "z", { ctrlKey: true, shiftKey: true }); // redo
    expect(ta.value).toBe("");
    expect(e2.defaultPrevented).toBe(true);
  });

  it("Cmd+Z (macOS) also restores", () => {
    const GA = makeGA();
    const c = GA.Composer({ onSubmit: () => {} });
    document.body.appendChild(c.el);
    const ta = c.textarea;
    ta.value = "mac text";
    c.el.querySelector(".ga-send").click();
    expect(ta.value).toBe("");
    key(ta, "z", { metaKey: true });
    expect(ta.value).toBe("mac text");
  });

  it("Ctrl+Z on an empty stack does NOT preventDefault (native undo preserved)", () => {
    const GA = makeGA();
    const c = GA.Composer({ onSubmit: () => {} });
    document.body.appendChild(c.el);
    const e = key(c.textarea, "z", { ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
  });

  it("ariaLabel overrides the placeholder-derived label; placeholder remains the fallback", () => {
    const GA = makeGA();
    const labeled = GA.Composer({
      placeholder: "Ask a follow-up about the highlighted text…",
      ariaLabel: "Ask a follow-up about the highlighted text",
      onSubmit: () => {},
    });
    expect(labeled.textarea.getAttribute("aria-label")).toBe(
      "Ask a follow-up about the highlighted text",
    );
    expect(labeled.textarea.getAttribute("placeholder")).toBe(
      "Ask a follow-up about the highlighted text…",
    );

    const fallback = GA.Composer({ placeholder: "Type here…", onSubmit: () => {} });
    expect(fallback.textarea.getAttribute("aria-label")).toBe("Type here…");
  });

  it("Enter still submits with the undo keydown listener attached", () => {
    const GA = makeGA();
    const sent = [];
    const c = GA.Composer({ onSubmit: (t) => sent.push(t) });
    document.body.appendChild(c.el);
    c.textarea.value = "via enter";
    key(c.textarea, "Enter");
    expect(sent).toEqual(["via enter"]);
    expect(c.textarea.value).toBe("");
  });
});

describe("GA.Composer draft handoff", () => {
  it("draft() reads and setDraft() writes + resizes, without touching undo", () => {
    const GA = makeGA();
    const c = GA.Composer({ onSubmit: () => {} });
    document.body.appendChild(c.el);
    c.setDraft("carried over");
    expect(c.draft()).toBe("carried over");
    expect(c.textarea.value).toBe("carried over");
    c.setDraft("");
    expect(c.draft()).toBe("");
  });
});

describe("GA.Composer markdown toggle", () => {
  it("is absent by default, present with markdownToggle, and stamps onSubmit", () => {
    const GA = makeGA();
    const plain = GA.Composer({ onSubmit: () => {} });
    expect(plain.el.querySelector(".ga-md-btn")).toBeFalsy();

    const sent = [];
    const c = GA.Composer({ markdownToggle: true, onSubmit: (t, o) => sent.push([t, o]) });
    document.body.appendChild(c.el);
    const btn = c.el.querySelector(".ga-md-btn");
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-pressed")).toBe("false");

    c.textarea.value = "plain message";
    key(c.textarea, "Enter");
    expect(sent[0]).toEqual(["plain message", { md: false }]);

    btn.click();
    expect(btn.classList.contains("ga-md-on")).toBe(true);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    c.textarea.value = "# markdown message";
    key(c.textarea, "Enter");
    expect(sent[1]).toEqual(["# markdown message", { md: true }]);
  });

  it("the last toggle state is the session default for new composers", () => {
    const GA = makeGA();
    const first = GA.Composer({ markdownToggle: true, onSubmit: () => {} });
    first.el.querySelector(".ga-md-btn").click(); // turn MD on
    const second = GA.Composer({ markdownToggle: true, onSubmit: () => {} });
    expect(second.el.querySelector(".ga-md-btn").classList.contains("ga-md-on")).toBe(true);
    second.el.querySelector(".ga-md-btn").click(); // leave the default off for other specs
  });
});

describe("GA.Composer fence-aware Enter", () => {
  it("plain Enter inside an unclosed ``` fence does not submit; Ctrl+Enter always does", () => {
    const GA = makeGA();
    const sent = [];
    const c = GA.Composer({ onSubmit: (t) => sent.push(t) });
    document.body.appendChild(c.el);

    c.textarea.value = "```js\nconst x = 1;";
    c.textarea.selectionStart = c.textarea.value.length;
    const e = key(c.textarea, "Enter");
    expect(sent).toHaveLength(0); // newline, not send
    expect(e.defaultPrevented).toBe(false); // native newline allowed through

    key(c.textarea, "Enter", { ctrlKey: true }); // escape hatch
    expect(sent).toHaveLength(1);

    // a CLOSED fence sends normally again
    c.textarea.value = "```js\nx\n``` done";
    c.textarea.selectionStart = c.textarea.value.length;
    key(c.textarea, "Enter");
    expect(sent).toHaveLength(2);
  });
});

describe("GA.Composer resize grip", () => {
  function drag(grip, fromY, toY) {
    grip.dispatchEvent(
      new window.MouseEvent("mousedown", { button: 0, clientY: fromY, bubbles: true }),
    );
    document.dispatchEvent(new window.MouseEvent("mousemove", { clientY: toY }));
    document.dispatchEvent(new window.MouseEvent("mouseup", {}));
  }

  it("is opt-in, grows the input on upward drag, clamps, and suspends autosize", () => {
    const GA = makeGA();
    expect(GA.Composer({ onSubmit: () => {} }).el.querySelector(".ga-composer-grip")).toBeFalsy();

    const c = GA.Composer({ resizable: true, onSubmit: () => {} });
    document.body.appendChild(c.el);
    const grip = c.el.querySelector(".ga-composer-grip");
    expect(grip).toBeTruthy();

    drag(grip, 500, 300); // 200px up from a 0 jsdom start height
    const h = parseInt(c.textarea.style.height, 10);
    expect(h).toBeGreaterThanOrEqual(GA.config.COMPOSER_MANUAL_MIN_PX);
    expect(h).toBeLessThanOrEqual(
      Math.round(window.innerHeight * GA.config.COMPOSER_MANUAL_MAX_FRAC),
    );
    expect(c.el.classList.contains("ga-composer-manual")).toBe(true);

    // manual height wins: typing (autosize) must not snap it back
    c.textarea.value = "x";
    c.textarea.dispatchEvent(new window.Event("input"));
    expect(parseInt(c.textarea.style.height, 10)).toBe(h);

    // double-click resets to auto-grow
    grip.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
    expect(c.el.classList.contains("ga-composer-manual")).toBe(false);
  });
});

describe("GA.fitTextarea", () => {
  it("keeps the current height when the element is hidden (scrollHeight 0)", () => {
    const GA = makeGA();
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.style.height = "48px";
    // jsdom has no layout, so scrollHeight is natively 0 — the hidden case.
    expect(GA.fitTextarea(ta)).toBe("48px");
  });

  it("returns the measured height, capped at a viewport fraction (floor TEXTAREA_MAX_PX)", () => {
    const GA = makeGA();
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);

    Object.defineProperty(ta, "scrollHeight", { value: 64, configurable: true });
    expect(GA.fitTextarea(ta)).toBe("64px");

    // grow-to-fit: the cap is a viewport fraction so typed text stays visible
    const cap = Math.max(
      GA.config.TEXTAREA_MAX_PX,
      Math.round(window.innerHeight * GA.config.TEXTAREA_GROW_MAX_FRAC),
    );
    Object.defineProperty(ta, "scrollHeight", { value: 5000, configurable: true });
    expect(GA.fitTextarea(ta)).toBe(cap + "px");

    // short viewports keep the fixed floor
    const origH = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { value: 200, configurable: true });
    expect(GA.fitTextarea(ta)).toBe(GA.config.TEXTAREA_MAX_PX + "px");
    Object.defineProperty(window, "innerHeight", { value: origH, configurable: true });
  });
});

describe("GA.Composer research toggle", () => {
  const TOGGLE = { label: "Claude", model: "claude-x" };

  it("is absent without researchToggle", () => {
    const GA = makeGA();
    const c = GA.Composer({ markdownToggle: true, onSubmit() {} });
    expect(c.el.querySelector(".ga-research-btn")).toBeNull();
  });

  it("sits after the MD button with a globe icon, title and aria-pressed", () => {
    const GA = makeGA();
    const c = GA.Composer({ markdownToggle: true, researchToggle: TOGGLE, onSubmit() {} });
    const btns = [...c.el.querySelectorAll(".ga-composer-controls .ga-iconbtn")];
    expect(btns.map((b) => b.classList.contains("ga-research-btn"))).toEqual([false, true]);
    const rb = btns[1];
    expect(rb.title).toBe("Research this (searches the web with Claude)");
    expect(rb.getAttribute("aria-pressed")).toBe("false");
    expect(rb.querySelector("svg path")).toBeTruthy();
    expect(c.el.querySelector(".ga-send").textContent).toBe("Ask");
  });

  it("on: hides the picker, relabels send + placeholder, submits {md, research} with no provider", () => {
    const GA = makeGA();
    const sent = [];
    const providers = GA.core.sites.askOptions("claude", { geminiApiKey: "g" });
    const c = GA.Composer({
      placeholder: "Ask away",
      markdownToggle: true,
      providers,
      researchToggle: TOGGLE,
      onSubmit: (t, o) => sent.push(o),
    });
    const sel = c.el.querySelector(".ga-provider-select");
    sel.value = "gemini";
    sel.dispatchEvent(new window.Event("change"));
    const rb = c.el.querySelector(".ga-research-btn");
    rb.click();
    expect(rb.classList.contains("ga-research-on")).toBe(true);
    expect(rb.getAttribute("aria-pressed")).toBe("true");
    expect(c.el.querySelector(".ga-provider-wrap").hidden).toBe(true);
    expect(c.el.querySelector(".ga-send").textContent).toBe("Research");
    expect(c.textarea.placeholder).toBe("Ask a research question about the highlighted text…");

    c.textarea.value = "find sources";
    c.el.querySelector(".ga-send").click();
    expect(sent[0]).toEqual({ md: false, research: true });

    c.setLoading(true);
    c.setLoading(false);
    expect(c.el.querySelector(".ga-send").textContent).toBe("Research");

    rb.click(); // off again: everything restored, provider pick applies
    expect(c.el.querySelector(".ga-provider-wrap").hidden).toBe(false);
    expect(c.el.querySelector(".ga-send").textContent).toBe("Ask");
    expect(c.textarea.placeholder).toBe("Ask away");
    c.textarea.value = "again";
    c.el.querySelector(".ga-send").click();
    expect(sent[1]).toEqual({ md: false, provider: "gemini" });
  });

  it("the last state is the session default for new composers", () => {
    const GA = makeGA();
    const a = GA.Composer({ researchToggle: TOGGLE, onSubmit() {} });
    a.el.querySelector(".ga-research-btn").click();
    const b = GA.Composer({ researchToggle: TOGGLE, onSubmit() {} });
    expect(b.el.querySelector(".ga-research-btn").getAttribute("aria-pressed")).toBe("true");
    expect(b.el.querySelector(".ga-send").textContent).toBe("Research");
    // A composer without the toggle never inherits research mode.
    const sent = [];
    const plain = GA.Composer({ onSubmit: (t, o) => sent.push(o) });
    plain.textarea.value = "q";
    plain.el.querySelector(".ga-send").click();
    expect(sent[0]).toEqual({ md: false });
  });
});
