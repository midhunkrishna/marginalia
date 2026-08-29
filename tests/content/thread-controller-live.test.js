// Live-stream fan-out + modal minimize/restore (controller side): askThread
// feeds every chunk into the live registry so a surface opened mid-stream can
// late-join via handlers.liveStream; expandThread minimizes the docked box
// transiently (never persisted) and restores it on modal close.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

function makeController() {
  const GA = loadGA([
    "src/core/sites.js",
    "src/core/prompt.js",
    "src/core/live-stream.js",
    "src/core/session-bindings.js",
    "src/content/ask-flow.js",
    "src/content/thread-controller.js",
  ]);

  GA.warn = vi.fn();
  GA.config = { REANCHOR_RETRY_MS: [] };
  GA.provider = "chatgpt"; // no Gemini web-token path
  GA.settings = { scope: "section" };
  GA.store = {
    load: vi.fn(async () => []),
    migrateDraft: vi.fn(async () => {}),
    upsert: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  GA.selection = {
    highlightThread: vi.fn(),
    anchorEl: vi.fn(() => ({})),
    unhighlight: vi.fn(),
    reanchorAll: vi.fn(),
  };
  GA.gutter = {
    add: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    relayout: vi.fn(),
    scheduleLayout: vi.fn(),
    focusThread: vi.fn(),
    get: vi.fn(),
  };
  GA.Modal = { open: vi.fn(), close: vi.fn() };
  GA.ThreadBox = vi.fn(() => ({ focusInput: vi.fn() }));
  GA.askService = { ask: vi.fn() };
  return GA;
}

const record = (id) => ({
  id,
  selector: { exact: "quoted " + id },
  anchor: { role: "model", turn: 1 },
  section: "section text",
  messages: [],
  createdAt: 1000,
});

// Restore one thread and hand back the handlers ThreadBox received.
async function restoreOne(GA, id = "t1") {
  GA.store.load.mockResolvedValue([record(id)]);
  await GA.threadController.restoreForSession("chatgpt:s1");
  const thread = GA.threadController.threads()[0];
  const handlers = GA.ThreadBox.mock.calls[0][1];
  return { thread, handlers };
}

describe("askThread live-stream fan-out", () => {
  let GA;
  beforeEach(() => {
    GA = makeController();
  });

  it("chunks reach both the caller and a late-joining feed; done fires on settle", async () => {
    const captured = {};
    GA.askService.ask.mockImplementation((req, onChunk) => {
      captured.onChunk = onChunk;
      return { result: new Promise((res) => (captured.resolve = res)) };
    });
    const { thread, handlers } = await restoreOne(GA);

    const callerChunks = [];
    const turn = handlers.ask(thread, { onChunk: (t) => callerChunks.push(t) });
    await Promise.resolve(); // let askThread reach askService.ask

    const feed = handlers.liveStream(thread.id);
    expect(feed).not.toBeNull();

    captured.onChunk("par");
    captured.onChunk("partial");
    expect(callerChunks).toEqual(["par", "partial"]); // caller unchanged
    expect(feed.text).toBe("partial"); // late joiner sees the so-far text

    const seen = [];
    feed.subscribe((text, done) => seen.push([text, done]));
    captured.resolve("final");
    await turn;

    expect(seen[seen.length - 1]).toEqual(["partial", true]); // done on settle
    expect(handlers.liveStream(thread.id)).toBeNull(); // feed removed
  });

  it("the feed ends (and is removed) when the ask rejects", async () => {
    let reject;
    GA.askService.ask.mockImplementation(() => ({
      result: new Promise((res, rej) => (reject = rej)),
    }));
    const { thread, handlers } = await restoreOne(GA);

    const turn = handlers.ask(thread, {});
    await Promise.resolve();
    const done = vi.fn();
    handlers.liveStream(thread.id).subscribe(done);

    reject(new Error("boom"));
    await expect(turn).rejects.toThrow("boom");
    expect(done).toHaveBeenCalledWith("", true);
    expect(handlers.liveStream(thread.id)).toBeNull();
  });

  it("stores the conversation ids from a {text, ids} result and returns the text", async () => {
    GA.askService.ask.mockImplementation((req) => {
      expect(req.ids).toBeUndefined(); // fresh thread asks stateless
      return {
        result: Promise.resolve({ text: "answer", ids: ["c_1", "r_1", "rc_1"] }),
        stop: vi.fn(),
        abort: vi.fn(),
      };
    });
    const { thread, handlers } = await restoreOne(GA);

    const text = await handlers.ask(thread, {});
    expect(text).toBe("answer");
    expect(thread.geminiIds).toEqual(["c_1", "r_1", "rc_1"]);
    expect(GA.store.upsert).toHaveBeenCalled();

    // The follow-up reuses the captured triplet.
    GA.askService.ask.mockImplementation((req) => {
      expect(req.ids).toEqual(["c_1", "r_1", "rc_1"]);
      return { result: Promise.resolve("second"), stop: vi.fn(), abort: vi.fn() };
    });
    await handlers.ask(thread, {});
  });
});

describe("expandThread minimize/restore", () => {
  let GA;
  let box;
  beforeEach(() => {
    GA = makeController();
    box = {
      focusInput: vi.fn(),
      isCompact: vi.fn(() => false),
      setCollapsed: vi.fn(),
      refreshMessages: vi.fn(),
      takeDraft: vi.fn(() => ""),
      setDraft: vi.fn(),
    };
    GA.gutter.get.mockReturnValue({ box });
  });

  it("collapses the box transiently on open and restores + refreshes on close", async () => {
    await restoreOne(GA, "t1");
    GA.threadController.expandThreadById("t1");

    expect(box.setCollapsed).toHaveBeenCalledWith(true, { persist: false }); // transient
    expect(GA.Modal.open).toHaveBeenCalledTimes(1);

    const onClosed = GA.Modal.open.mock.calls[0][2];
    onClosed();
    expect(box.setCollapsed).toHaveBeenLastCalledWith(false, { persist: false });
    expect(box.refreshMessages).toHaveBeenCalledTimes(1);
    expect(GA.gutter.scheduleLayout).toHaveBeenCalled();
  });

  it("carries the box draft into the modal and hands the leftover back on close", async () => {
    box.takeDraft.mockReturnValue("two sentences in progress");
    await restoreOne(GA, "t1");
    GA.threadController.expandThreadById("t1");

    expect(box.takeDraft).toHaveBeenCalledTimes(1);
    expect(GA.Modal.open.mock.calls[0][3]).toEqual({ draft: "two sentences in progress" });

    const onClosed = GA.Modal.open.mock.calls[0][2];
    onClosed("edited in the modal, still unsent");
    expect(box.setDraft).toHaveBeenCalledWith("edited in the modal, still unsent");
  });

  it("an empty modal draft still writes back (the setDraft re-fits the textarea)", async () => {
    await restoreOne(GA, "t1");
    GA.threadController.expandThreadById("t1");
    GA.Modal.open.mock.calls[0][2]("");
    expect(box.setDraft).toHaveBeenCalledWith("");
  });

  it("takes the draft before collapsing the box (a hidden textarea measures 0)", async () => {
    await restoreOne(GA, "t1");
    GA.threadController.expandThreadById("t1");
    expect(box.takeDraft.mock.invocationCallOrder[0]).toBeLessThan(
      box.setCollapsed.mock.invocationCallOrder[0],
    );
  });

  it("an already-minimized box is left alone (and stays minimized on close)", async () => {
    box.isCompact.mockReturnValue(true);
    await restoreOne(GA, "t1");
    GA.threadController.expandThreadById("t1");
    GA.Modal.open.mock.calls[0][2]();

    expect(box.setCollapsed).not.toHaveBeenCalled();
    expect(box.refreshMessages).toHaveBeenCalledTimes(1);
  });

  it("hands the modal a handlers object that includes liveStream", async () => {
    await restoreOne(GA, "t1");
    GA.threadController.expandThreadById("t1");
    const handlers = GA.Modal.open.mock.calls[0][1];
    expect(typeof handlers.liveStream).toBe("function");
    expect(handlers.liveStream("t1")).toBeNull(); // nothing in flight
  });

  it("makeHandlers includes inRail, reflecting the gutter's rail mode", async () => {
    const { handlers } = await restoreOne(GA, "t1");
    expect(typeof handlers.inRail).toBe("function");
    GA.gutter.mode = vi.fn(() => "rail");
    expect(handlers.inRail()).toBe(true);
    GA.gutter.mode = vi.fn(() => "full");
    expect(handlers.inRail()).toBe(false);
  });
});
