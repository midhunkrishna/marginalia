import { describe, it, expect } from "vitest";
import sse from "../../src/shared/sse.js";
import geminiParser from "../../src/gemini/parser.js";
import claudeParser from "../../src/claude/parser.js";

// Equivalence ratchet: feeding a transcript through the incremental cursor in
// arbitrary chunk splits must match parseLatest over the whole buffer — at the
// end AND at every intermediate complete-line boundary.

function chunkSplits(s, sizes) {
  const out = [];
  let i = 0;
  let k = 0;
  while (i < s.length) {
    const n = sizes[k++ % sizes.length];
    out.push(s.slice(i, i + n));
    i += n;
  }
  return out;
}

function assertEquivalent(makeStream, parseLatest, transcript) {
  for (const sizes of [[1], [3], [7], [1000], [2, 5, 11]]) {
    const stream = makeStream();
    let fed = "";
    for (const chunk of chunkSplits(transcript, sizes)) {
      const streamed = stream.push(chunk);
      fed += chunk;
      // compare only at complete-line boundaries — mid-line the whole-buffer
      // parser sees a JSON-broken tail that contributes nothing either way
      if (fed.endsWith("\n")) expect(streamed).toBe(parseLatest(fed));
    }
    expect(stream.end()).toBe(parseLatest(transcript));
  }
}

describe("sse.makeStream ≡ sse.makeParser", () => {
  const extract = (obj) => {
    const delta = obj && obj.choices && obj.choices[0] && obj.choices[0].delta;
    return delta && typeof delta.content === "string" ? delta.content : null;
  };

  it("openai-style transcript, all chunkings", () => {
    const transcript =
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n' +
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n' +
      "\n" +
      "event: something\n" +
      'data: {"choices":[{"delta":{"content":"lo — ünïcodé"}}]}\n' +
      "data: [DONE]\n";
    assertEquivalent(() => sse.makeStream(extract), sse.makeParser(extract), transcript);
  });

  it("returns null before any text event", () => {
    const s = sse.makeStream(extract);
    expect(s.push("event: ping\n")).toBeNull();
    expect(s.push('data: {"choices":[{"delta":{}}]}\n')).toBeNull();
    expect(s.end()).toBeNull();
  });

  it("a trailing line without a newline is flushed by end()", () => {
    const s = sse.makeStream(extract);
    s.push('data: {"choices":[{"delta":{"content":"tail"}}]}'); // no \n
    expect(s.end()).toBe("tail");
  });
});

describe("claude parser stream ≡ parseLatest", () => {
  it("delta + legacy completion shapes", () => {
    const transcript =
      'data: {"type":"content_block_delta","delta":{"text":"Hel"}}\n' +
      'data: {"type":"completion","completion":"lo"}\n' +
      'data: {"type":"message_stop"}\n';
    assertEquivalent(claudeParser.makeStream, claudeParser.parseLatest, transcript);
  });
});

describe("gemini frame parser stream ≡ parseLatest", () => {
  function frame(text) {
    const body = [null, ["c_x", "r_x"], null, null, [["rc_x", [text]]]];
    const item = ["wrb.fr", "f.abc", JSON.stringify(body), null, null, null, "generic"];
    return JSON.stringify([item]) + "\n";
  }
  function metaFrame() {
    // no candidates — only ids; must never overwrite the answer
    const body = [null, ["c_12345678deadbeef", "r_12345678deadbeef"]];
    const item = ["wrb.fr", "f.abc", JSON.stringify(body), null, null, null, "generic"];
    return JSON.stringify([item]) + "\n";
  }

  it("growing frames + trailing metadata frame, all chunkings", () => {
    const transcript =
      ")]}'\n\n" + "123\n" + frame("Hel") + "456\n" + frame("Hello world") + metaFrame();
    assertEquivalent(geminiParser.makeStream, geminiParser.parseLatest, transcript);
    // and the final answer is the longest precise text, not the metadata
    expect(geminiParser.parseLatest(transcript)).toBe("Hello world");
  });

  it("keeps the longest answer when a later frame is shorter", () => {
    const transcript = frame("A long complete answer") + frame("A long");
    assertEquivalent(geminiParser.makeStream, geminiParser.parseLatest, transcript);
    expect(geminiParser.parseLatest(transcript)).toBe("A long complete answer");
  });
});

describe("sse.makeEventStream", () => {
  const transcript =
    "event: message_start\n" +
    'data: {"type":"a","n":1}\n' +
    ": comment\n" +
    "\n" +
    "data: {not json}\n" +
    'data:{"type":"b","n":2}\r\n' +
    "data: [DONE]\n" +
    'data: {"type":"c","n":3}'; // trailing line, no newline

  it("hands every parsed data event to handle, for all chunkings", () => {
    for (const sizes of [[1], [3], [7], [1000], [2, 5, 11]]) {
      const seen = [];
      const s = sse.makeEventStream((obj) => {
        seen.push(obj.n);
        return null;
      });
      for (const chunk of chunkSplits(transcript, sizes)) s.push(chunk);
      expect(seen).toEqual([1, 2]); // the unterminated line waits for end()
      expect(s.end()).toBeNull();
      expect(seen).toEqual([1, 2, 3]);
    }
  });

  it("returns handle's latest non-null value as the text so far", () => {
    let acc = "";
    const s = sse.makeEventStream((obj) => (obj.t ? (acc += obj.t) : null));
    expect(s.push("event: ping\n")).toBeNull();
    expect(s.push('data: {"t":"He"}\ndata: {"x":1}\n')).toBe("He");
    expect(s.push('data: {"t":"llo"}')).toBe("He"); // line not complete yet
    expect(s.end()).toBe("Hello");
  });

  it("tolerates null chunks and an empty end()", () => {
    const s = sse.makeEventStream(() => "x");
    expect(s.push(null)).toBeNull();
    expect(s.end()).toBeNull();
  });
});
