// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Thread labels in the docked box: the /label composer intercept (a command,
// never an LLM turn), the label section under the header, the pencil editor,
// and the labeled-chip class.

function makeGA() {
  return loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/config.js",
      "src/core/labels.js",
      "src/core/sites.js",
      "src/core/quick-actions.js",
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
      requestAnimationFrame: (f) => (f(), 0),
      cancelAnimationFrame: () => {},
    },
  );
}

const pressKey = (key) =>
  new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });

afterEach(() => {
  document.body.innerHTML = "";
});

function submitText(box, text) {
  box.el.querySelector(".ga-input").value = text;
  box.el.querySelector(".ga-send").click();
}

const pillTexts = (box) =>
  Array.from(box.el.querySelectorAll(".ga-thread-labels .ga-label-pill"), (p) => p.textContent);

describe("/label in the box composer", () => {
  it("routes to onLabel and renders the section — the turn machinery never runs", () => {
    const GA = makeGA();
    const runSpy = vi.spyOn(GA.threadTurn, "run");
    const thread = {
      id: "t1",
      selector: { exact: "highlighted text" },
      messages: [{ role: "user", text: "earlier question" }],
    };
    const onLabel = vi.fn((t, labels) => {
      t.labels = GA.core.labels.merge(t.labels, labels); // controller policy
    });
    const box = GA.ThreadBox(thread, { persist: vi.fn(), onLabel });
    document.body.appendChild(box.el);
    box.naturalHeight(); // first measure materializes the lazy history
    expect(box.el.querySelector(".ga-thread-labels").children).toHaveLength(0);

    submitText(box, '/label project.ux "needs review"');

    expect(onLabel).toHaveBeenCalledWith(thread, ["project.ux", "needs review"]);
    expect(runSpy).not.toHaveBeenCalled();
    expect(pillTexts(box)).toEqual(["project.ux", "needs review"]);
    expect(box.el.classList.contains("ga-has-labels")).toBe(true);
    // command text is not a message
    expect(box.el.querySelectorAll(".ga-msg")).toHaveLength(1);
  });

  it("a malformed /label toasts and never reaches onLabel or the LLM", () => {
    const GA = makeGA();
    const runSpy = vi.spyOn(GA.threadTurn, "run");
    const onLabel = vi.fn();
    const box = GA.ThreadBox(
      { id: "t2", selector: { exact: "x" }, messages: [] },
      { persist: vi.fn(), onLabel },
    );
    document.body.appendChild(box.el);

    submitText(box, "/label bad..name");

    expect(onLabel).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
    expect(document.querySelector(".ga-toast").textContent).toContain("bad..name");
  });

  it("survives onLabel destroying the box (empty-thread conversion path)", () => {
    const GA = makeGA();
    const thread = { id: "t3", selector: { exact: "x" }, messages: [] };
    let box;
    const onLabel = vi.fn(() => box.destroy()); // controller swaps surface
    box = GA.ThreadBox(thread, { persist: vi.fn(), onLabel });
    document.body.appendChild(box.el);

    expect(() => submitText(box, "/label todo")).not.toThrow();
    expect(onLabel).toHaveBeenCalledWith(thread, ["todo"]);
    expect(box.el.isConnected).toBe(false);
  });
});

describe("label section rendering + pencil editor", () => {
  it("restored labels render pills; collapsing marks the chip ga-has-labels", () => {
    const GA = makeGA();
    const thread = {
      id: "t4",
      selector: { exact: "x" },
      messages: [],
      labels: ["project.ux"],
    };
    const box = GA.ThreadBox(thread, { persist: vi.fn() });
    document.body.appendChild(box.el);

    expect(pillTexts(box)).toEqual(["project.ux"]);
    expect(box.el.classList.contains("ga-has-labels")).toBe(true);
    expect(box.el.querySelector(".ga-box-header .ga-label-glyph")).toBeTruthy();

    box.setCollapsed(true);
    expect(box.el.classList.contains("ga-collapsed")).toBe(true);
    expect(box.el.classList.contains("ga-has-labels")).toBe(true);
  });

  it("pencil opens the pill editor: x removes one label, the add-input merges", () => {
    const GA = makeGA();
    const persist = vi.fn();
    const thread = {
      id: "t5",
      selector: { exact: "x" },
      messages: [{ role: "user", text: "q" }],
      labels: ["needs review", "todo"],
    };
    const onLabel = vi.fn((t, labels) => {
      t.labels = GA.core.labels.merge(t.labels, labels); // controller policy
    });
    const box = GA.ThreadBox(thread, { persist, onLabel });
    document.body.appendChild(box.el);

    box.el.querySelector(".ga-label-editbtn").click();
    // same pill-by-pill model as the standalone chip
    const editorPills = () =>
      Array.from(box.el.querySelectorAll(".ga-thread-labels .ga-label-pill-text"), (p) =>
        p.textContent.trim(),
      );
    expect(editorPills()).toEqual(["needs review", "todo"]);

    box.el.querySelector(".ga-label-remove").click(); // removes "needs review"
    expect(thread.labels).toEqual(["todo"]);
    expect(persist).toHaveBeenCalledWith(thread);

    const input = box.el.querySelector(".ga-label-edit");
    input.value = "project.ux";
    input.dispatchEvent(pressKey("Enter"));
    expect(onLabel).toHaveBeenCalledWith(thread, ["project.ux"]);
    expect(editorPills()).toEqual(["todo", "project.ux"]);
  });

  it("the tag header button opens label entry with zero syntax", () => {
    const GA = makeGA();
    const thread = { id: "t5b", selector: { exact: "x" }, messages: [], labels: [] };
    const onLabel = vi.fn();
    const box = GA.ThreadBox(thread, { persist: vi.fn(), onLabel });
    document.body.appendChild(box.el);

    box.el.querySelector(".ga-labelbtn").click();
    const input = box.el.querySelector(".ga-label-edit");
    expect(input).toBeTruthy();
    input.value = "todo";
    input.dispatchEvent(pressKey("Enter"));
    // empty thread: routed to the controller, which converts to a label chip
    expect(onLabel).toHaveBeenCalledWith(thread, ["todo"]);
  });

  it("invalid additions toast and keep the editor open; Escape closes it", () => {
    const GA = makeGA();
    const persist = vi.fn();
    const onLabel = vi.fn();
    const thread = { id: "t6", selector: { exact: "x" }, messages: [], labels: ["keep"] };
    const box = GA.ThreadBox(thread, { persist, onLabel });
    document.body.appendChild(box.el);

    box.el.querySelector(".ga-label-editbtn").click();
    let input = box.el.querySelector(".ga-label-edit");
    input.value = "bad..name";
    input.dispatchEvent(pressKey("Enter"));
    expect(onLabel).not.toHaveBeenCalled(); // rejected — nothing committed
    expect(thread.labels).toEqual(["keep"]);
    expect(box.el.querySelector(".ga-label-edit")).toBeTruthy(); // still editing
    expect(document.querySelector(".ga-toast").textContent).toContain("bad..name");

    input = box.el.querySelector(".ga-label-edit");
    input.dispatchEvent(pressKey("Escape"));
    expect(box.el.querySelector(".ga-label-edit")).toBeFalsy();
    expect(pillTexts(box)).toEqual(["keep"]);
  });

  it("refreshMessages re-renders labels appended elsewhere (the modal's /label path)", () => {
    const GA = makeGA();
    const thread = { id: "t8", selector: { exact: "x" }, messages: [], labels: [] };
    const box = GA.ThreadBox(thread, { persist: vi.fn() });
    document.body.appendChild(box.el);
    expect(box.el.classList.contains("ga-has-labels")).toBe(false);

    // The modal's intercept mutates the record directly; the docked box only
    // hears about it through the controller's onClosed → refreshMessages.
    thread.labels = ["from.modal"];
    box.refreshMessages();

    expect(pillTexts(box)).toEqual(["from.modal"]);
    expect(box.el.classList.contains("ga-has-labels")).toBe(true);
  });

  it("removing every pill clears the labels and the chip marker", () => {
    const GA = makeGA();
    const thread = { id: "t7", selector: { exact: "x" }, messages: [], labels: ["a", "b"] };
    const box = GA.ThreadBox(thread, { persist: vi.fn() });
    document.body.appendChild(box.el);

    box.el.querySelector(".ga-label-editbtn").click();
    box.el.querySelector(".ga-label-remove").click();
    box.el.querySelector(".ga-label-remove").click();

    expect(thread.labels).toEqual([]);
    expect(box.el.classList.contains("ga-has-labels")).toBe(false);
  });
});

describe("draft handoff + markdown messages (box side)", () => {
  it("takeDraft reads-and-clears; setDraft restores", () => {
    const GA = makeGA();
    const box = GA.ThreadBox(
      { id: "d1", selector: { exact: "x" }, messages: [] },
      { persist: vi.fn() },
    );
    document.body.appendChild(box.el);
    box.el.querySelector(".ga-input").value = "typed two sentences";
    expect(box.takeDraft()).toBe("typed two sentences");
    expect(box.el.querySelector(".ga-input").value).toBe("");
    box.setDraft("came back from the modal");
    expect(box.el.querySelector(".ga-input").value).toBe("came back from the modal");
  });

  it("a restored md:true user message renders markdown; plain stays literal", () => {
    const GA = makeGA();
    const box = GA.ThreadBox(
      {
        id: "d2",
        selector: { exact: "x" },
        messages: [
          { role: "user", text: "```py\nprint(1)\n```", md: true },
          { role: "user", text: "* not a list" },
        ],
      },
      { persist: vi.fn() },
    );
    document.body.appendChild(box.el);
    box.naturalHeight(); // first measure materializes the lazy history
    const msgs = box.el.querySelectorAll(".ga-msg-user");
    expect(msgs[0].querySelector("pre, code")).toBeTruthy();
    expect(msgs[1].querySelector("ul, li, pre, code")).toBeFalsy();
    expect(msgs[1].textContent).toBe("* not a list");
  });
});
