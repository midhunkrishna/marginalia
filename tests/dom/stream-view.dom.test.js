// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// GA.StreamView — the shared streaming state machine thread-ui and the modal
// both render replies through: rAF-coalesced incremental updates, final-text
// resolution (pending ?? lastText), error suppression, the aria/class
// lifecycle, and the optional announce hook. Plus GA.errorCard's two shapes.

function makeGA(raf) {
  return loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/copy.js",
      "src/shared/config.js",
      "src/core/sites.js",
      "src/core/markdown-ast.js",
      "src/content/util.js",
      "src/content/icons.js",
      "src/content/markdown.js",
      "src/content/stream-view.js",
    ],
    raf || {
      // Deterministic sync animation frames unless a spec supplies its own.
      requestAnimationFrame: (f) => (f(), 0),
      cancelAnimationFrame: () => {},
    },
  );
}

// Hooks with recording fakes; every spec drives the machine directly.
function makeView(GA, overrides = {}) {
  const calls = { afterUpdate: 0, finals: [], errors: [], finishes: [], ends: 0, announced: [] };
  const el = document.createElement("div");
  document.body.appendChild(el);
  const view = GA.StreamView({
    beginEl: () => el,
    isLive: () => true,
    afterUpdate: () => calls.afterUpdate++,
    renderFinal: (e, text) => calls.finals.push(text),
    renderError: (e, message) => calls.errors.push(message),
    onFinish: (e, text) => calls.finishes.push(text),
    onEnd: () => calls.ends++,
    announce: (text) => calls.announced.push(text),
    ...overrides,
  });
  return { view, el, calls };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("StreamView — rAF coalescing", () => {
  it("multiple renderModel calls inside one frame flush once, with the last text", () => {
    // Manual frame queue: chunks arrive faster than frames.
    let queued = null;
    const GA = makeGA({
      requestAnimationFrame: (f) => ((queued = f), 1),
      cancelAnimationFrame: () => {},
    });
    const { view, el, calls } = makeView(GA);
    const updates = [];
    vi.spyOn(GA.markdown, "makeStreamRenderer").mockReturnValue({
      update: (t) => updates.push(t),
    });

    view.beginModel();
    view.renderModel(el, "a");
    view.renderModel(el, "ab");
    view.renderModel(el, "abc");
    expect(updates).toEqual([]); // nothing until the frame fires

    queued();
    expect(updates).toEqual(["abc"]); // one flush, latest text
    expect(calls.afterUpdate).toBe(1);
  });

  it("cancel() drops the pending text — the queued frame renders nothing", () => {
    let queued = null;
    const GA = makeGA({
      requestAnimationFrame: (f) => ((queued = f), 1),
      cancelAnimationFrame: () => {
        queued = null;
      },
    });
    const { view, el, calls } = makeView(GA);
    const updates = [];
    vi.spyOn(GA.markdown, "makeStreamRenderer").mockReturnValue({
      update: (t) => updates.push(t),
    });

    view.beginModel();
    view.renderModel(el, "partial");
    view.cancel();
    if (queued) queued(); // even a frame that already escaped cancels cleanly
    expect(updates).toEqual([]);
    expect(calls.afterUpdate).toBe(0);
  });
});

describe("StreamView — endModel final text", () => {
  it("resolves the final text from un-flushed pending ahead of lastText", () => {
    let queued = null;
    const GA = makeGA({
      requestAnimationFrame: (f) => ((queued = f), 1),
      cancelAnimationFrame: () => {
        queued = null;
      },
    });
    const { view, el, calls } = makeView(GA);

    view.beginModel();
    view.renderModel(el, "old");
    queued(); // "old" flushed -> lastText
    view.renderModel(el, "newer, never flushed");
    view.endModel(el);

    expect(calls.finals).toEqual(["newer, never flushed"]); // pending wins
    expect(calls.finishes).toEqual(["newer, never flushed"]);
    expect(calls.ends).toBe(1);
  });

  it("falls back to lastText when nothing is pending; no text at all skips finalize but still ends", () => {
    const GA = makeGA();
    const { view, el, calls } = makeView(GA);

    view.beginModel();
    view.renderModel(el, "flushed text"); // sync rAF: flushes immediately
    view.endModel(el);
    expect(calls.finals).toEqual(["flushed text"]);

    view.beginModel();
    view.endModel(el); // no chunks at all
    expect(calls.finals).toEqual(["flushed text"]); // no second final render
    expect(calls.finishes).toEqual(["flushed text"]);
    expect(calls.ends).toBe(2); // onEnd always
  });

  it("renderFinal is gated on isLive, onFinish is not (dead-box bookkeeping still runs)", () => {
    const GA = makeGA();
    let live = true;
    const { view, el, calls } = makeView(GA, { isLive: () => live });

    view.beginModel();
    view.renderModel(el, "answer");
    live = false; // surface destroyed mid-turn
    view.endModel(el);

    expect(calls.finals).toEqual([]); // no render into the dead surface
    expect(calls.finishes).toEqual(["answer"]); // bookkeeping still fires
    expect(calls.ends).toBe(1);
  });
});

describe("StreamView — error path", () => {
  it("renderError suppresses later flushes and the finalize, but onEnd still fires", () => {
    let queued = null;
    const GA = makeGA({
      requestAnimationFrame: (f) => ((queued = f), 1),
      cancelAnimationFrame: () => {
        queued = null;
      },
    });
    const { view, el, calls } = makeView(GA);
    const updates = [];
    vi.spyOn(GA.markdown, "makeStreamRenderer").mockReturnValue({
      update: (t) => updates.push(t),
    });

    view.beginModel();
    view.renderModel(el, "half an ans");
    view.renderError(el, "Request failed.");
    expect(calls.errors).toEqual(["Request failed."]);
    if (queued) queued();
    expect(updates).toEqual([]); // the queued flush was cancelled/suppressed

    view.endModel(el);
    expect(calls.finals).toEqual([]); // error card keeps the message
    expect(calls.finishes).toEqual([]);
    expect(calls.ends).toBe(1); // error path still ends
    expect(el.classList.contains("ga-msg-streaming")).toBe(false);
  });
});

describe("StreamView — class/aria lifecycle and announcements", () => {
  it("beginModel marks streaming + busy; endModel clears both", () => {
    const GA = makeGA();
    const { view, el } = makeView(GA);

    const returned = view.beginModel();
    expect(returned).toBe(el);
    expect(el.classList.contains("ga-msg-streaming")).toBe(true);
    expect(el.getAttribute("aria-busy")).toBe("true");

    view.renderModel(el, "done");
    view.endModel(el);
    expect(el.classList.contains("ga-msg-streaming")).toBe(false);
    expect(el.hasAttribute("aria-busy")).toBe(false);
  });

  it("announces started/finished/failed through the hook", () => {
    const GA = makeGA();
    const { view, el, calls } = makeView(GA);

    view.beginModel();
    view.renderModel(el, "text");
    view.endModel(el);
    expect(calls.announced).toEqual(["Reply started", "Reply finished"]);

    view.beginModel();
    view.renderError(el, "boom");
    view.endModel(el);
    expect(calls.announced).toEqual([
      "Reply started",
      "Reply finished",
      "Reply started",
      "Reply failed: boom",
    ]);
  });

  it("a view without announce/onFinish/onEnd hooks (the modal's shape) never throws", () => {
    const GA = makeGA();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const view = GA.StreamView({
      beginEl: () => el,
      isLive: () => true,
      afterUpdate: () => {},
      renderFinal: () => {},
      renderError: () => {},
    });

    expect(() => {
      view.beginModel();
      view.renderModel(el, "text");
      view.endModel(el);
    }).not.toThrow();
  });
});

describe("GA.errorCard", () => {
  it("builds icon + text, and only adds Retry when onRetry is provided", () => {
    const GA = makeGA();
    const bare = GA.errorCard("It broke.");
    expect(bare.className).toBe("ga-error-card");
    expect(bare.querySelector(".ga-error-icon svg")).not.toBeNull();
    expect(bare.querySelector(".ga-error-text").textContent).toBe("It broke.");
    expect(bare.querySelector(".ga-retry-btn")).toBeNull();

    const onRetry = vi.fn();
    const card = GA.errorCard("It broke.", { onRetry });
    const btn = card.querySelector(".ga-retry-btn");
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("aria-label")).toBe("Retry question");
    expect(btn.textContent).toContain("Retry");
    btn.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("adds the trust line under key/auth-class errors only", () => {
    const GA = makeGA();
    const keyCard = GA.errorCard("OpenAI API error (HTTP 401): Incorrect API key provided.", {
      onRetry: () => {},
    });
    expect(keyCard.querySelector(".ga-error-trust").textContent).toBe(GA.copy.TRUST_LINE);
    // the message itself stays untouched, and the trust line is the card's last child
    expect(keyCard.querySelector(".ga-error-text").textContent).toBe(
      "OpenAI API error (HTTP 401): Incorrect API key provided.",
    );
    expect(keyCard.lastElementChild.classList.contains("ga-error-trust")).toBe(true);
    const missing = GA.errorCard("Add your Claude API key in Marginalia's options.");
    expect(missing.querySelector(".ga-error-trust")).not.toBeNull();

    for (const other of [
      "OpenAI API error (HTTP 429): rate limited",
      "Anthropic request timed out.",
      "Connection to extension closed.",
      "Request failed.",
    ]) {
      expect(GA.errorCard(other).querySelector(".ga-error-trust"), other).toBeNull();
    }
  });

  it("the Retry click does not bubble out of the card (box focus handlers stay quiet)", () => {
    const GA = makeGA();
    const card = GA.errorCard("x", { onRetry: () => {} });
    document.body.appendChild(card);
    const outer = vi.fn();
    document.body.addEventListener("click", outer);
    card.querySelector(".ga-retry-btn").click();
    expect(outer).not.toHaveBeenCalled();
    document.body.removeEventListener("click", outer);
  });
});

describe("adaptive flush cadence (long answers batch, short ones don't)", () => {
  function withClock() {
    vi.useFakeTimers();
    const origNow = performance.now.bind(performance);
    let offset = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => origNow() + offset);
    return {
      tick(ms) {
        offset += ms;
        vi.advanceTimersByTime(ms);
      },
      done() {
        spy.mockRestore();
        vi.useRealTimers();
      },
    };
  }

  it("short answers render on every flush; long answers hold within the window", () => {
    const clock = withClock();
    const GA = makeGA();
    const { view, calls } = makeView(GA);
    const el = view.beginModel();

    view.renderModel(el, "one");
    view.renderModel(el, "one two");
    expect(calls.afterUpdate).toBe(2); // short: every frame renders

    const long = "x".repeat(3000);
    view.renderModel(el, long + " a"); // window elapsed since lastRender? offset 0 — due
    clock.tick(80); // move past the window so the next long render is due
    view.renderModel(el, long + " ab");
    const rendered = calls.afterUpdate;
    view.renderModel(el, long + " abc"); // inside the fresh window -> held
    view.renderModel(el, long + " abcd"); // still held
    expect(calls.afterUpdate).toBe(rendered);

    clock.tick(80); // trailing hold fires — stalled text still paints
    expect(calls.afterUpdate).toBe(rendered + 1);
    view.endModel(el);
    expect(calls.finals).toEqual([long + " abcd"]);
    clock.done();
  });

  it("endModel renders the exact final text and kills any pending hold", () => {
    const clock = withClock();
    const GA = makeGA();
    const { view, calls } = makeView(GA);
    const el = view.beginModel();
    const long = "y".repeat(3000);
    view.renderModel(el, long);
    view.renderModel(el, long + " tail"); // held (inside window)
    view.endModel(el);
    expect(calls.finals).toEqual([long + " tail"]); // last chunk never dropped
    const renders = calls.afterUpdate;
    clock.tick(300); // the cancelled hold must not fire a stale render
    expect(calls.afterUpdate).toBe(renders);
    clock.done();
  });
});
