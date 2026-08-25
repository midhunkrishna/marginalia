import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// transcript.js is pure and binds only to GA.core.turnId — load exactly that
// pair, the same order the manifests use.
const GA = loadGA([
  "src/core/sites.js",
  "src/core/turn-id.js",
  "src/core/outline.js",
  "src/core/transcript.js",
]);
const { build } = GA.core.transcript;
const fpOf = (text) => GA.core.turnId.fingerprint(text);

const turn = (role, text, order) => ({ role, text, fp: fpOf(text), order });

let seq = 0;
const thread = (over = {}) => ({
  id: "t" + ++seq,
  selector: { exact: "highlighted words" },
  anchor: null,
  section: "",
  messages: [],
  createdAt: 1000 + seq,
  ...over,
});
const anchorTo = (role, text) => ({ v: 2, role, turn: fpOf(text) });

const convo = (turns, over = {}) => ({
  title: "Rust borrow checker",
  url: "https://gemini.google.com/app/abc123",
  provider: "gemini",
  capturedAt: Date.UTC(2026, 6, 10, 12, 30),
  turns,
  ...over,
});

describe("prefix-dedupe of stale mid-stream partials (fix F3)", () => {
  it("consecutive same-role turns where one is a strict prefix render only the longer", () => {
    const md = build(
      convo([
        turn("user", "Explain lifetimes", 0),
        turn("model", "Lifetimes are", 1),
        turn("model", "Lifetimes are how the borrow checker reasons about scope.", 2),
      ]),
      [],
    );
    expect(md).toContain("Lifetimes are how the borrow checker reasons about scope.");
    // The partial does not render as its own turn: exactly one Assistant section.
    expect(md.match(/^## Assistant$/gm)).toHaveLength(1);
  });

  it("drops the shorter even when the partial is stored AFTER the completed turn", () => {
    const md = build(
      convo([
        turn("model", "The full completed answer about traits.", 0),
        turn("model", "The full completed", 1),
      ]),
      [],
    );
    expect(md.match(/^## Assistant$/gm)).toHaveLength(1);
    expect(md).toContain("The full completed answer about traits.");
  });

  it("collapses a chain of partials (A, AB, ABC) to the longest", () => {
    const md = build(
      convo([
        turn("model", "Step one", 0),
        turn("model", "Step one and step two", 1),
        turn("model", "Step one and step two and step three", 2),
      ]),
      [],
    );
    expect(md.match(/^## Assistant$/gm)).toHaveLength(1);
    expect(md).toContain("Step one and step two and step three");
  });

  it("prefix comparison uses normalized text (whitespace reflow still dedupes)", () => {
    const md = build(
      convo([
        turn("model", "Alpha   beta\n gamma", 0),
        turn("model", "Alpha beta gamma delta epsilon", 1),
      ]),
      [],
    );
    expect(md.match(/^## Assistant$/gm)).toHaveLength(1);
    expect(md).toContain("delta epsilon");
  });

  it("keeps non-prefix same-role neighbors (regenerated answers are a documented limitation)", () => {
    const md = build(
      convo([
        turn("model", "First answer about apples.", 0),
        turn("model", "Second answer about oranges.", 1),
      ]),
      [],
    );
    expect(md.match(/^## Assistant$/gm)).toHaveLength(2);
    expect(md).toContain("apples");
    expect(md).toContain("oranges");
  });

  it("keeps different-role prefix pairs", () => {
    const md = build(
      convo([
        turn("user", "Explain traits", 0),
        turn("model", "Explain traits? Sure — here is how.", 1),
      ]),
      [],
    );
    expect(md.match(/^## You$/gm)).toHaveLength(1);
    expect(md.match(/^## Assistant$/gm)).toHaveLength(1);
  });

  it("keeps identical consecutive same-role turns (repeated messages are legitimate, not partials)", () => {
    const md = build(convo([turn("user", "try again", 0), turn("user", "try again", 1)]), []);
    expect(md.match(/^## You$/gm)).toHaveLength(2);
  });

  it("does not dedupe across a gap (different-role turn between the partial and the completion)", () => {
    const md = build(
      convo([
        turn("model", "Partial thought", 0),
        turn("user", "go on", 1),
        turn("model", "Partial thought completed in full.", 2),
      ]),
      [],
    );
    expect(md.match(/^## Assistant$/gm)).toHaveLength(2);
    expect(md.match(/^## You$/gm)).toHaveLength(1);
  });

  it("a thread anchored to the DROPPED partial re-homes onto the completed turn via its quote", () => {
    const partial = "Lifetimes are";
    const full = "Lifetimes are how the borrow checker reasons about scope.";
    const th = thread({
      anchor: anchorTo("model", partial),
      selector: { exact: "Lifetimes" },
      messages: [{ role: "user", text: "what does this mean?", ts: 1 }],
    });
    const md = build(convo([turn("model", partial, 0), turn("model", full, 1)]), [th]);
    // quote containment places it under the surviving full turn — no
    // Unanchored section needed, nothing lost
    expect(md).not.toContain("## Unanchored notes");
    const at = md.indexOf("what does this mean?");
    expect(at).toBeGreaterThan(md.indexOf(full));
  });

  it("quote fallback respects the anchor's recorded role — a quote repeated in a user turn cannot capture a model-anchored thread", () => {
    const th = thread({
      anchor: anchorTo("model", "some turn that is gone"),
      selector: { exact: "shared words" },
      messages: [{ role: "user", text: "note body", ts: 1 }],
    });
    const md = build(
      convo([
        turn("user", "I quote shared words here first", 0),
        turn("model", "The answer also has shared words in it.", 1),
      ]),
      [th],
    );
    const at = md.indexOf("note body");
    expect(at).toBeGreaterThan(md.indexOf("The answer also has shared words"));
    expect(md).not.toContain("## Unanchored notes");
  });
});

describe("turn layout", () => {
  it("renders turns sorted by order with role headings, even when stored out of order", () => {
    const md = build(
      convo([
        turn("model", "Answer text.", 1),
        turn("user", "Question text.", 0),
        turn("user", "Follow-up question.", 2),
      ]),
      [],
    );
    const q = md.indexOf("Question text.");
    const a = md.indexOf("Answer text.");
    const f = md.indexOf("Follow-up question.");
    expect(q).toBeGreaterThan(-1);
    expect(a).toBeGreaterThan(q);
    expect(f).toBeGreaterThan(a);
    expect(md.match(/^## You$/gm)).toHaveLength(2);
    expect(md.match(/^## Assistant$/gm)).toHaveLength(1);
    // Heading precedes its text.
    expect(md.indexOf("## You")).toBeLessThan(q);
  });

  it("null/unknown role gets a fallback heading instead of throwing", () => {
    const md = build(
      convo([{ role: null, text: "orphan text", fp: fpOf("orphan text"), order: 0 }]),
      [],
    );
    expect(md).toContain("## Message");
    expect(md).toContain("orphan text");
  });

  it("header reflects convo metadata and frames the doc as a captured transcript", () => {
    const md = build(convo([turn("user", "hi", 0)]), []);
    expect(md.startsWith("# Rust borrow checker\n")).toBe(true);
    expect(md).toContain("gemini");
    expect(md).toContain("https://gemini.google.com/app/abc123");
    expect(md).toContain("2026-07-10 12:30 UTC");
    expect(md).toMatch(/captured transcript/i);
    // Never asserts full-conversation fidelity.
    expect(md).not.toMatch(/full conversation|complete transcript|entire conversation/i);
  });
});

describe("thread placement", () => {
  const question = "What are lifetimes exactly?";
  const answer = "They are named regions of code a reference must be valid for.";

  const anchoredThread = (turnText, over = {}) =>
    thread({
      anchor: anchorTo("model", turnText),
      selector: { exact: "borrow checker" },
      messages: [
        { role: "user", text: question, ts: 1 },
        { role: "model", text: answer, ts: 2 },
      ],
      ...over,
    });

  it("a matching thread renders as a blockquote callout after its turn, with quote + full Q&A", () => {
    const turnText = "The borrow checker enforces aliasing rules.";
    const md = build(
      convo([
        turn("user", "Explain the borrow checker", 0),
        turn("model", turnText, 1),
        turn("user", "thanks", 2),
      ]),
      [anchoredThread(turnText)],
    );
    const turnAt = md.indexOf(turnText);
    const quoteAt = md.indexOf('> "borrow checker"');
    const qAt = md.indexOf(question);
    const aAt = md.indexOf(answer);
    const nextTurnAt = md.lastIndexOf("## You");
    expect(quoteAt).toBeGreaterThan(turnAt);
    expect(qAt).toBeGreaterThan(quoteAt);
    expect(aAt).toBeGreaterThan(qAt);
    expect(quoteAt).toBeLessThan(nextTurnAt);
    // Q&A lines live inside the blockquote with speaker labels.
    expect(md).toContain("> **You:** " + question);
    expect(md).toContain("> **Assistant:** " + answer);
    expect(md).toContain("> [!note] Annotation");
    expect(md).not.toContain("## Unanchored notes");
  });

  it("a labeled thread's callout carries a Labels line between quote and Q&A", () => {
    const turnText = "The borrow checker enforces aliasing rules.";
    const md = build(convo([turn("model", turnText, 0)]), [
      anchoredThread(turnText, { labels: ["rust.ownership", "todo"] }),
    ]);
    expect(md).toContain("> **Labels:** rust.ownership, todo");
    const labelsAt = md.indexOf("**Labels:**");
    expect(labelsAt).toBeGreaterThan(md.indexOf('> "borrow checker"'));
    expect(labelsAt).toBeLessThan(md.indexOf("> **You:**"));
    // label-less callouts are unchanged
    const plain = build(convo([turn("model", turnText, 0)]), [anchoredThread(turnText)]);
    expect(plain).not.toContain("**Labels:**");
  });

  it("multi-line thread messages stay inside the blockquote", () => {
    const turnText = "Answer with structure.";
    const md = build(convo([turn("model", turnText, 0)]), [
      thread({
        anchor: anchorTo("model", turnText),
        messages: [{ role: "model", text: "line one\nline two", ts: 1 }],
      }),
    ]);
    expect(md).toContain("> **Assistant:** line one\n> line two");
  });

  it("a thread with a null anchor lands under Unanchored notes", () => {
    const md = build(convo([turn("user", "hello", 0)]), [
      thread({ anchor: null, selector: { exact: "legacy quote" } }),
    ]);
    const sec = md.indexOf("## Unanchored notes");
    expect(sec).toBeGreaterThan(-1);
    expect(md.indexOf('> "legacy quote"')).toBeGreaterThan(sec);
  });

  it("a thread whose fingerprint matches no turn lands under Unanchored notes", () => {
    const md = build(convo([turn("model", "present turn", 0)]), [
      thread({
        anchor: anchorTo("model", "a turn that was never captured"),
        selector: { exact: "ghost" },
      }),
    ]);
    expect(md.indexOf('> "ghost"')).toBeGreaterThan(md.indexOf("## Unanchored notes"));
  });

  it("attaches a thread to the FIRST matching turn when fingerprints repeat", () => {
    const text = "repeat me";
    const md = build(convo([turn("user", text, 0), turn("user", text, 1)]), [
      thread({ anchor: anchorTo("user", text), selector: { exact: "repeat" } }),
    ]);
    // Callout appears once, between the first and second copies of the turn.
    expect(md.match(/> "repeat"/g)).toHaveLength(1);
    const first = md.indexOf(text);
    const second = md.indexOf(text, first + 1);
    const callout = md.indexOf('> "repeat"');
    expect(callout).toBeGreaterThan(first);
    expect(callout).toBeLessThan(second);
  });

  it("multiple threads on one turn render in createdAt order regardless of array order", () => {
    const turnText = "shared turn";
    const late = thread({
      anchor: anchorTo("model", turnText),
      selector: { exact: "LATE" },
      createdAt: 2000,
    });
    const early = thread({
      anchor: anchorTo("model", turnText),
      selector: { exact: "EARLY" },
      createdAt: 100,
    });
    const md = build(convo([turn("model", turnText, 0)]), [late, early]);
    expect(md.indexOf('> "EARLY"')).toBeLessThan(md.indexOf('> "LATE"'));
  });

  it("unanchored list is ordered by createdAt", () => {
    const b = thread({ selector: { exact: "BBB" }, createdAt: 500 });
    const a = thread({ selector: { exact: "AAA" }, createdAt: 50 });
    const md = build(convo([]), [b, a]);
    expect(md.indexOf('> "AAA"')).toBeLessThan(md.indexOf('> "BBB"'));
  });
});

describe("defensive inputs", () => {
  it("null convo and null threads produce a valid document", () => {
    const md = build(null, null);
    expect(typeof md).toBe("string");
    expect(md.startsWith("# Captured conversation")).toBe(true);
    expect(md.endsWith("\n")).toBe(true);
  });

  it("missing turns / missing metadata do not throw", () => {
    const md = build({ title: "", turns: "corrupt" }, [thread()]);
    expect(md).toContain("## Unanchored notes");
  });

  it("non-object turns and threads are skipped", () => {
    const md = build(convo([null, "junk", turn("user", "real turn", 0)]), [null, undefined]);
    expect(md).toContain("real turn");
    expect(md).not.toContain("## Unanchored notes");
  });

  it("a thread missing selector.exact and messages still renders a callout", () => {
    const md = build(convo([]), [thread({ selector: {}, messages: undefined })]);
    expect(md).toContain("> [!note] Annotation");
    expect(md).toContain("no highlighted text recorded");
  });

  it("invalid capturedAt omits the date line instead of rendering garbage", () => {
    const md = build(convo([], { capturedAt: "not a date" }), []);
    expect(md).not.toContain("Captured:");
    expect(md).not.toContain("Invalid");
  });

  it("a turn with empty text keeps its heading and stays valid", () => {
    const md = build(convo([{ role: "user", text: "", fp: { hash: 1, len: 0 }, order: 0 }]), []);
    expect(md).toContain("## You");
  });
});

describe("markdown hygiene (no HTML, no structure forgery)", () => {
  // A "<" that survives unescaped is a potential raw-HTML pass-through; every
  // one in the output must carry its backslash escape.
  const unescapedLt = /(?<!\\)</;

  it("HTML in turn text never passes through raw", () => {
    const md = build(convo([turn("model", 'Try <script>alert("x")</script> here', 0)]), []);
    expect(md).not.toMatch(unescapedLt);
    expect(md).toContain("\\<script>");
  });

  it("HTML in thread quote and messages never passes through raw", () => {
    const md = build(convo([]), [
      thread({
        selector: { exact: "<img src=x onerror=alert(1)>" },
        messages: [{ role: "user", text: "<b>bold?</b>", ts: 1 }],
      }),
    ]);
    expect(md).not.toMatch(unescapedLt);
    expect(md).toContain("\\<img");
    expect(md).toContain("\\<b>");
  });

  it("turn text cannot forge headings or blockquotes", () => {
    const md = build(convo([turn("model", "# Fake heading\n> fake quote", 0)]), []);
    expect(md).not.toMatch(/^# Fake heading$/m);
    expect(md).not.toMatch(/^> fake quote$/m);
    expect(md).toContain("\\# Fake heading");
    expect(md).toContain("\\> fake quote");
  });

  it("a newline in the title cannot break the header line", () => {
    const md = build(convo([], { title: "line one\n# injected" }), []);
    // Whitespace collapse neutralizes the newline: the "#" lands mid-line,
    // where it cannot open a heading.
    expect(md.startsWith("# line one # injected\n")).toBe(true);
  });

  it("CRLF text is normalized to LF", () => {
    const md = build(convo([turn("user", "a\r\nb\rc", 0)]), []);
    expect(md).not.toContain("\r");
    expect(md).toContain("a\nb\nc");
  });
});

// ---- issue #8: provenance in the export -----------------------------------
describe("provider stamps", () => {
  it("names the answering provider on stamped replies, plain 'Assistant' otherwise", () => {
    const turnText = "Rust has no garbage collector.";
    const md = build(convo([turn("model", turnText, 0)]), [
      thread({
        anchor: anchorTo("model", turnText),
        messages: [
          { role: "user", text: "why?", ts: 1 },
          { role: "model", text: "site says", ts: 2 },
          { role: "model", text: "gemini says", ts: 3, provider: "gemini" },
          { role: "model", text: "odd says", ts: 4, provider: "<x>" },
        ],
      }),
    ]);
    expect(md).toContain("> **Assistant:** site says");
    expect(md).toContain("> **Assistant (Gemini):** gemini says");
    expect(md).toContain("> **Assistant (\\<x>):** odd says");
  });
});
