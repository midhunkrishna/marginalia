// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Focus mode (T-002): a USER click on a thread — its box, its chip, or its page
// highlight — collapses every OTHER expanded box to its chip via
// GA.gutter.focusThread(id). Programmatic activations (Alt+↓/↑ cycling,
// panel.go, restore) stay on plain setActive and must NOT collapse others.
// These specs drive the gutter seam directly with real ThreadBoxes.

function makeGA() {
  const GA = loadGA([
    "src/shared/settings-schema.js",
    "src/shared/config.js",
    "src/core/sites.js",
    "src/core/quick-actions.js",
    "src/core/labels.js",
    "src/core/markdown-ast.js",
    "src/core/layout-engine.js",
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
    "src/content/gutter.js",
  ]);
  // Stub the collaborators gutter/ThreadBox reach for, so nothing auto-relayouts
  // and no CSS-anchor / highlight machinery runs under jsdom.
  GA.frame = { schedule: () => {} }; // relayout only runs when we call it explicitly
  GA.panel = { toggle: () => {} };
  GA.supportsCssAnchor = () => false;
  GA.selection = {
    anchorEl: () => null,
    setActiveHighlight: () => {},
    ensureAnchorName: () => {},
    setHighlightState: () => {},
    setHighlightHover: () => {},
  };
  return GA;
}

function makeBox(GA, id) {
  return GA.ThreadBox({ id, selector: { exact: id }, messages: [] }, { onResize: () => {} });
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("GA.gutter.focusThread — collapse others on user click", () => {
  it("collapses every other expanded box to its chip and keeps the clicked one expanded", () => {
    const GA = makeGA();
    const a = makeBox(GA, "a");
    const b = makeBox(GA, "b");
    const c = makeBox(GA, "c");
    GA.gutter.add("a", a);
    GA.gutter.add("b", b);
    GA.gutter.add("c", c);
    expect([a, b, c].map((x) => x.isCompact())).toEqual([false, false, false]);

    GA.gutter.focusThread("a");

    expect(a.isCompact()).toBe(false); // clicked thread stays expanded
    expect(b.isCompact()).toBe(true);
    expect(c.isCompact()).toBe(true);
    expect(GA.gutter.activeId()).toBe("a"); // delegated to setActive
  });

  it("does not force-expand a collapsed/resolved target and never fights its resolved state", () => {
    const GA = makeGA();
    const a = makeBox(GA, "a");
    const b = makeBox(GA, "b");
    GA.gutter.add("a", a);
    GA.gutter.add("b", b);
    b.setResolved(true); // resolved -> collapsed muted chip
    expect(b.isCompact()).toBe(true);

    // Focusing the resolved box must not re-expand it.
    GA.gutter.focusThread("b");
    expect(b.isCompact()).toBe(true);
    expect(a.isCompact()).toBe(true); // the other one collapses

    // The chip-click handler (thread-ui) restores `a`; focusThread itself never
    // force-expands a target. Once a is expanded, focusing it must leave the
    // resolved chip `b` collapsed — never re-expand or reopen a resolved thread.
    a.setCollapsed(false); // stand-in for the chip-click restore
    GA.gutter.focusThread("a");
    expect(a.isCompact()).toBe(false);
    expect(b.isCompact()).toBe(true);
  });

  it("plain setActive (Alt cycle / panel.go / restore path) does NOT collapse others", () => {
    const GA = makeGA();
    const a = makeBox(GA, "a");
    const b = makeBox(GA, "b");
    GA.gutter.add("a", a);
    GA.gutter.add("b", b);

    GA.gutter.setActive("a"); // programmatic activation

    expect(a.isCompact()).toBe(false);
    expect(b.isCompact()).toBe(false); // untouched — no collapse-others
    expect(GA.gutter.activeId()).toBe("a");
  });

  it("re-clicking the already-active thread re-collapses others that were re-expanded", () => {
    const GA = makeGA();
    const a = makeBox(GA, "a");
    const b = makeBox(GA, "b");
    GA.gutter.add("a", a);
    GA.gutter.add("b", b);

    GA.gutter.focusThread("a"); // a active, b collapsed
    expect(b.isCompact()).toBe(true);

    b.setCollapsed(false); // user re-expands b in the meantime
    expect(b.isCompact()).toBe(false);

    // setActive("a") would early-return (a still active), but the collapse sweep
    // in focusThread runs FIRST, so b collapses again.
    GA.gutter.focusThread("a");
    expect(a.isCompact()).toBe(false);
    expect(b.isCompact()).toBe(true);
  });

  it("toggleAllCollapsed is unchanged by focus mode", () => {
    const GA = makeGA();
    const a = makeBox(GA, "a");
    const b = makeBox(GA, "b");
    const c = makeBox(GA, "c");
    GA.gutter.add("a", a);
    GA.gutter.add("b", b);
    GA.gutter.add("c", c);

    GA.gutter.toggleAllCollapsed(); // anything expanded -> collapse all
    expect([a, b, c].map((x) => x.isCompact())).toEqual([true, true, true]);

    GA.gutter.toggleAllCollapsed(); // nothing expanded -> expand all
    expect([a, b, c].map((x) => x.isCompact())).toEqual([false, false, false]);
  });

  it("createFromSelection sequence: a new thread born from a selection collapses the others", () => {
    const GA = makeGA();
    const a = makeBox(GA, "a");
    const b = makeBox(GA, "b");
    const c = makeBox(GA, "c");
    GA.gutter.add("a", a);
    GA.gutter.add("b", b);
    GA.gutter.add("c", c);

    // Mirror the exact levers createFromSelection now uses post-persist:
    //   addThread -> gutter.add(newId, newBox)  (registered + expanded)
    //   gutter.focusThread(newId)               (others collapse, new stays open)
    //   gutter.relayout()                       (single settle pass)
    const newBox = makeBox(GA, "n");
    GA.gutter.add("n", newBox);
    GA.gutter.focusThread("n");
    GA.gutter.relayout();

    expect(newBox.isCompact()).toBe(false); // new thread stays expanded
    expect([a, b, c].map((x) => x.isCompact())).toEqual([true, true, true]);
    expect(GA.gutter.activeId()).toBe("n");
  });
});
