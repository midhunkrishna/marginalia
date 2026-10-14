// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// First DOM coverage for GA.Modal: snapshot render, edge drag-resize with
// session memory, and late-joining a live stream (modal opened mid-answer).

function makeGA() {
  return loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/config.js",
      "src/core/sites.js",
      "src/core/quick-actions.js",
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
      "src/content/modal.js",
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

const makeThread = (messages = []) => ({
  id: "t1",
  selector: { exact: "highlighted text" },
  messages,
});

const baseHandlers = () => ({ ask: vi.fn(async () => ""), persist: vi.fn() });

// A stand-in for a core/live-stream feed with inspectable listeners.
function makeFeed(text) {
  const listeners = new Set();
  return {
    text,
    listeners,
    push(t) {
      this.text = t;
      listeners.forEach((fn) => fn(t, false));
    },
    end() {
      listeners.forEach((fn) => fn(this.text, true));
      listeners.clear();
    },
    subscribe(fn) {
      listeners.add(fn);
    },
    unsubscribe(fn) {
      listeners.delete(fn);
    },
  };
}

const drag = (target, from, to) => {
  target.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: from, bubbles: true }));
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: to }));
  document.dispatchEvent(new MouseEvent("mouseup", {}));
};

describe("Modal — snapshot render", () => {
  it("renders thread history and closes via onClosed", () => {
    const GA = makeGA();
    const onClosed = vi.fn();
    GA.Modal.open(
      makeThread([
        { role: "user", text: "why?" },
        { role: "model", text: "because" },
      ]),
      baseHandlers(),
      onClosed,
    );

    const msgs = document.querySelectorAll(".ga-modal-body .ga-msg");
    expect(msgs).toHaveLength(2);
    expect(msgs[1].textContent).toContain("because");

    GA.Modal.close();
    expect(document.querySelector(".ga-modal-overlay")).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});

describe("Modal — drag-to-resize width", () => {
  it("right-edge drag widens by 2*dx from the 820px default and clamps to the max", () => {
    const GA = makeGA();
    GA.Modal.open(makeThread(), baseHandlers(), null);
    const panel = document.querySelector(".ga-modal");
    const right = panel.querySelector(".ga-modal-resize-right");

    drag(right, 500, 550); // dx +50 -> 820 + 100
    expect(panel.style.width).toBe("920px");

    drag(right, 500, 900); // way past the edge -> clamp at 95% of 1024
    expect(panel.style.width).toBe(Math.round(1024 * 0.95) + "px");
  });

  it("left-edge drag and the min clamp; width is remembered for the session", () => {
    const GA = makeGA();
    GA.Modal.open(makeThread(), baseHandlers(), null);
    let panel = document.querySelector(".ga-modal");

    drag(panel.querySelector(".ga-modal-resize-left"), 500, 900); // dx +400 leftwards -> shrink, clamp 420
    expect(panel.style.width).toBe("420px");

    GA.Modal.close();
    GA.Modal.open(makeThread(), baseHandlers(), null);
    panel = document.querySelector(".ga-modal");
    expect(panel.style.width).toBe("420px"); // session memory

    drag(panel.querySelector(".ga-modal-resize-right"), 500, 600); // 420 + 200
    expect(panel.style.width).toBe("620px");
  });

  it("listeners detach on mouseup — further moves change nothing", () => {
    const GA = makeGA();
    GA.Modal.open(makeThread(), baseHandlers(), null);
    const panel = document.querySelector(".ga-modal");

    drag(panel.querySelector(".ga-modal-resize-right"), 500, 550);
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 700 }));
    expect(panel.style.width).toBe("920px");
    expect(
      document.querySelector(".ga-modal-overlay").classList.contains("ga-modal-resizing"),
    ).toBe(false);
  });
});

describe("Modal — live stream late-join", () => {
  const openWithFeed = (GA, feed, thread) => {
    const handlers = {
      ...baseHandlers(),
      onStop: vi.fn(),
      liveStream: (id) => (id === thread.id ? feed : null),
    };
    GA.Modal.open(thread, handlers, null);
    return handlers;
  };

  it("seeds the bubble with the partial text and follows pushes", () => {
    const GA = makeGA();
    const feed = makeFeed("partial ans");
    openWithFeed(GA, feed, makeThread([{ role: "user", text: "q" }]));

    const bubble = document.querySelector(".ga-msg-streaming");
    expect(bubble).not.toBeNull();
    expect(bubble.textContent).toContain("partial ans");

    feed.push("partial answer grows");
    expect(bubble.textContent).toContain("partial answer grows");

    // composer is in Stop mode while attached
    expect(document.querySelector(".ga-input").disabled).toBe(true);
    expect(document.querySelector(".ga-send").textContent).toContain("Stop");
  });

  it("finalizes from thread.messages when the feed ends and re-enables the composer", async () => {
    const GA = makeGA();
    const feed = makeFeed("partial");
    const thread = makeThread([{ role: "user", text: "q" }]);
    openWithFeed(GA, feed, thread);

    feed.push("the full answer");
    thread.messages.push({ role: "model", text: "the full answer", ts: 1 }); // what the box's turn does
    feed.end();
    await tick();

    const bubble = document.querySelectorAll(".ga-modal-body .ga-msg")[1];
    expect(bubble.classList.contains("ga-msg-streaming")).toBe(false);
    expect(bubble.textContent).toContain("the full answer");
    expect(document.querySelector(".ga-input").disabled).toBe(false);
    expect(document.querySelector(".ga-send").textContent).toContain("Ask");
  });

  it("renders the error card when the settled message is an error", async () => {
    const GA = makeGA();
    const feed = makeFeed("");
    const thread = makeThread([{ role: "user", text: "q" }]);
    openWithFeed(GA, feed, thread);

    thread.messages.push({ role: "model", text: "Request failed.", error: true, ts: 1 });
    feed.end();
    await tick();

    expect(document.querySelector(".ga-error-card")).not.toBeNull();
    expect(document.querySelector(".ga-error-text").textContent).toBe("Request failed.");
  });

  it("closing the modal mid-stream unsubscribes from the feed", () => {
    const GA = makeGA();
    const feed = makeFeed("partial");
    openWithFeed(GA, feed, makeThread());

    expect(feed.listeners.size).toBe(1);
    GA.Modal.close();
    expect(feed.listeners.size).toBe(0);
  });
});

describe("draft handoff + composer upgrades", () => {
  it("opts.draft seeds the composer; closing returns the unsent draft", async () => {
    const GA = makeGA();
    const onClosed = vi.fn();
    GA.Modal.open(makeThread(), baseHandlers(), onClosed, { draft: "two sentences so far" });
    const ta = document.querySelector(".ga-modal .ga-input");
    expect(ta.value).toBe("two sentences so far");

    ta.value = "two sentences so far, plus edits";
    GA.Modal.close();
    expect(onClosed).toHaveBeenCalledWith("two sentences so far, plus edits");
  });

  it("a read-only modal (no handlers) closes with an empty draft", () => {
    const GA = makeGA();
    const onClosed = vi.fn();
    GA.Modal.open(makeThread(), null, onClosed);
    GA.Modal.close();
    expect(onClosed).toHaveBeenCalledWith("");
  });

  it("the modal composer has the resize grip and the MD toggle", () => {
    const GA = makeGA();
    GA.Modal.open(makeThread(), baseHandlers(), () => {});
    expect(document.querySelector(".ga-modal .ga-composer-grip")).toBeTruthy();
    expect(document.querySelector(".ga-modal .ga-md-btn")).toBeTruthy();
  });

  it("a stored md:true user message renders markdown; a plain one stays text", () => {
    const GA = makeGA();
    GA.Modal.open(
      makeThread([
        { role: "user", text: "```js\ncode();\n```", md: true },
        { role: "user", text: "# not a heading" },
      ]),
      baseHandlers(),
      () => {},
    );
    const msgs = document.querySelectorAll(".ga-modal .ga-msg-user");
    expect(msgs[0].querySelector("pre, code")).toBeTruthy();
    expect(msgs[1].querySelector("h1, pre, code")).toBeFalsy();
    expect(msgs[1].textContent).toBe("# not a heading");
  });
});

describe("Modal — label strip", () => {
  const labeledThread = (labels) => ({ ...makeThread(), labels });

  it("renders the thread's labels between header and body", () => {
    const GA = makeGA();
    GA.Modal.open(labeledThread(["project.ux", "todo"]), baseHandlers(), () => {});

    const strip = document.querySelector(".ga-modal .ga-thread-labels");
    expect(strip).toBeTruthy();
    expect(Array.from(strip.querySelectorAll(".ga-label-pill"), (p) => p.textContent)).toEqual([
      "project.ux",
      "todo",
    ]);
    expect(strip.previousElementSibling.classList.contains("ga-modal-header")).toBe(true);
    expect(strip.nextElementSibling.classList.contains("ga-modal-body")).toBe(true);
  });

  it("editing in the modal strip removes a label and persists to the record", () => {
    const GA = makeGA();
    const handlers = baseHandlers();
    const thread = labeledThread(["a", "b"]);
    GA.Modal.open(thread, handlers, () => {});

    document.querySelector(".ga-modal .ga-label-editbtn").click();
    document.querySelector(".ga-modal .ga-label-remove").click();
    expect(thread.labels).toEqual(["b"]);
    expect(handlers.persist).toHaveBeenCalledWith(thread);
  });

  it("/label in the modal composer updates the strip live (no toast, no LLM turn)", () => {
    const GA = makeGA();
    const runSpy = vi.spyOn(GA.threadTurn, "run");
    const thread = { ...makeThread([{ role: "user", text: "q" }]), labels: [] };
    const handlers = {
      ...baseHandlers(),
      onLabel: vi.fn((t, labels) => {
        t.labels = GA.core.labels.merge(t.labels, labels); // controller policy
      }),
    };
    GA.Modal.open(thread, handlers, () => {});

    const ta = document.querySelector(".ga-modal .ga-input");
    ta.value = "/label project.ux";
    document.querySelector(".ga-modal .ga-send").click();

    expect(handlers.onLabel).toHaveBeenCalledWith(thread, ["project.ux"]);
    expect(runSpy).not.toHaveBeenCalled();
    expect(document.querySelector(".ga-modal .ga-thread-labels .ga-label-pill")).toBeTruthy();
    expect(document.querySelector(".ga-toast")).toBeFalsy();
  });

  it("/label converting an empty thread still closes the modal", () => {
    const GA = makeGA();
    const thread = { ...makeThread(), labels: [] };
    const handlers = {
      ...baseHandlers(),
      onLabel: vi.fn((t, labels) => {
        t.kind = "label"; // controller converted the empty record
        t.labels = labels;
      }),
    };
    const onClosed = vi.fn();
    GA.Modal.open(thread, handlers, onClosed);

    const ta = document.querySelector(".ga-modal .ga-input");
    ta.value = "/label todo";
    document.querySelector(".ga-modal .ga-send").click();
    expect(onClosed).toHaveBeenCalled();
    expect(document.querySelector(".ga-modal")).toBeFalsy();
  });

  it("a label record opened with ask:null gets the strip but no composer", () => {
    const GA = makeGA();
    const thread = { ...labeledThread(["todo"]), kind: "label" };
    GA.Modal.open(thread, { ...baseHandlers(), ask: null }, () => {});

    expect(document.querySelector(".ga-modal .ga-thread-labels .ga-label-pill")).toBeTruthy();
    expect(document.querySelector(".ga-modal .ga-composer")).toBeFalsy();
    expect(document.querySelector(".ga-modal")).toBeTruthy(); // did not self-close
  });

  it("no handlers -> no strip, no crash (legacy read-only open)", () => {
    const GA = makeGA();
    GA.Modal.open(labeledThread(["todo"]), null, () => {});
    expect(document.querySelector(".ga-modal")).toBeTruthy();
    expect(document.querySelector(".ga-modal .ga-thread-labels")).toBeFalsy();
  });
});

// ---- research mode ---------------------------------------------------------
function makeResearchGA() {
  const GA = loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/config.js",
      "src/core/sites.js",
      "src/core/quick-actions.js",
      "src/core/labels.js",
      "src/core/citations.js",
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
      "src/content/modal.js",
    ],
    { requestAnimationFrame: (f) => (f(), 0), cancelAnimationFrame: () => {} },
  );
  GA.provider = "gemini";
  GA.settings = { researchProvider: "openai", openaiApiKey: "k" };
  return GA;
}

const SRC = [{ n: 2, title: "Two", url: "https://two.example/" }];

describe("Modal — research", () => {
  it("renders a stored research reply with its chip and linked citations", () => {
    const GA = makeResearchGA();
    GA.Modal.open(
      makeThread([
        { role: "user", text: "q", research: true, provider: "chatgpt" },
        {
          role: "model",
          text: "Claim [2].",
          provider: "chatgpt",
          research: { model: "m", sources: SRC },
        },
      ]),
      baseHandlers(),
      null,
    );
    const model = document.querySelector(".ga-modal .ga-msg-model");
    expect(model.querySelector(".ga-msg-research").textContent).toBe("Research via ChatGPT");
    const a = [...model.querySelectorAll("a")].find((x) => x.textContent === "2");
    expect(a.getAttribute("href")).toBe("https://two.example/");
  });

  it("offers the research toggle and runs a live research turn with a status line", async () => {
    const GA = makeResearchGA();
    let opts;
    let resolveAsk;
    const thread = makeThread();
    GA.Modal.open(
      thread,
      {
        ask: (t, o) =>
          new Promise((res) => {
            opts = o;
            resolveAsk = res;
          }),
        persist: vi.fn(),
      },
      null,
    );
    document.querySelector(".ga-modal .ga-research-btn").click();
    document.querySelector(".ga-modal .ga-input").value = "check it";
    document.querySelector(".ga-modal .ga-send").click();
    await tick();
    expect(opts).toMatchObject({ research: true, provider: "chatgpt" });

    const bubble = document.querySelector(".ga-modal .ga-msg-streaming");
    opts.onStep({ kind: "search", step: 1, query: "it" });
    opts.onChunk("Partial");
    opts.onStep({ kind: "final", step: 2 });
    const lines = bubble.querySelectorAll(".ga-research-status");
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe("Writing answer…");
    expect(bubble.querySelector(".ga-msg-research")).toBeTruthy(); // not clobbered by the stream

    resolveAsk({ text: "Done [2].", research: { model: "m", sources: SRC } });
    await tick();
    expect(bubble.querySelector(".ga-research-status")).toBeNull();
    const a = [...bubble.querySelectorAll("a")].find((x) => x.textContent === "2");
    expect(a.getAttribute("href")).toBe("https://two.example/");
  });

  it("has no research toggle when no research provider is configured", () => {
    const GA = makeResearchGA();
    GA.settings = {};
    GA.Modal.open(makeThread(), baseHandlers(), null);
    expect(document.querySelector(".ga-modal .ga-research-btn")).toBeNull();
  });
});
