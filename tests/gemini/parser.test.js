import { describe, it, expect } from "vitest";
import parser from "../../src/gemini/parser.js";

const { parseLatest, looksLikeId, conversationIds, makeStream } = parser;

// Build a representative StreamGenerate streamed response (batchexecute frames).
const PREFIX = ")]}'" + "\n\n";
function frame(body) {
  const item = ["wrb.fr", "f.abc", JSON.stringify(body), null, null, null, "generic"];
  const line = JSON.stringify([item]);
  return line.length + "\n" + line + "\n";
}
// body[4][0][1][0] = answer text ; body[1] = [cid, rid] ; body[4][0][0] = rcid
function answer(text, cid = "c_x", rid = "r_x", rcid = "rc_x") {
  return [null, [cid, rid], null, null, [[rcid, [text]]]];
}

describe("parseLatest", () => {
  it("returns null for empty / prefix-only input", () => {
    expect(parseLatest("")).toBeNull();
    expect(parseLatest(PREFIX)).toBeNull();
    expect(parseLatest(null)).toBeNull();
  });

  it("extracts the answer from a single frame", () => {
    expect(parseLatest(PREFIX + frame(answer("Hello")))).toBe("Hello");
  });

  it("returns the longest answer as the stream grows", () => {
    const raw = PREFIX + frame(answer("Hel")) + frame(answer("Hello, 8 KB pages."));
    expect(parseLatest(raw)).toBe("Hello, 8 KB pages.");
  });

  it("does NOT let a trailing metadata frame overwrite the answer (c_… regression)", () => {
    const meta = [null, ["c_566d09b3c0d14e2abf0000000000000517", "r_z"], null, null, null];
    const raw = PREFIX + frame(answer("The real answer is 42.")) + frame(meta);
    expect(parseLatest(raw)).toBe("The real answer is 42.");
  });

  it("never returns a bare conversation id", () => {
    const meta = [null, ["c_566d09b3c0d14e2abf0000000000000517", "r_z"], null, null, null];
    expect(parseLatest(PREFIX + frame(meta))).toBeNull();
  });

  it("ignores non-JSON wrb.fr lines and non-wrb.fr noise", () => {
    const raw = PREFIX + '54\n[["di",123]]\n' + "garbage\n" + frame(answer("Hi"));
    expect(parseLatest(raw)).toBe("Hi");
  });

  it("picks the answer (longest) when an answer and a short title RPC both appear", () => {
    const title = [null, ["c_x", "r_x"], null, null, [["rc_t", ["Re: pages"]]]];
    const raw =
      PREFIX + frame(title) + frame(answer("Pages are 8 KB because of the OS page size."));
    expect(parseLatest(raw)).toBe("Pages are 8 KB because of the OS page size.");
  });

  it("falls back to a nested answer when the precise path is absent", () => {
    const weird = [
      null,
      null,
      null,
      null,
      [["x", null, null, ["A reasonably long fallback answer."]]],
    ];
    expect(parseLatest(PREFIX + frame(weird))).toBe("A reasonably long fallback answer.");
  });

  it("preserves unicode and markdown in the answer", () => {
    const text = "Café ☕ — use `**bold**` and 日本語.";
    expect(parseLatest(PREFIX + frame(answer(text)))).toBe(text);
  });
});

describe("conversationIds", () => {
  it("extracts [cid, rid, rcid] from a reply body", () => {
    expect(conversationIds(answer("x", "c_1", "r_1", "rc_1"))).toEqual(["c_1", "r_1", "rc_1"]);
  });

  it("returns null when no id field exists anywhere", () => {
    expect(conversationIds([null, null, null, null, null])).toBeNull();
  });

  it("captures partial triplets (rcid-only bodies)", () => {
    expect(conversationIds([null, null, null, null, [["rc_x", ["text"]]]])).toEqual([
      null,
      null,
      "rc_x",
    ]);
  });

  it("makeStream exposes the latest triplet seen", () => {
    const s = makeStream();
    s.push(PREFIX + frame(answer("Hello", "c_a", "r_a", "rc_a")));
    expect(s.ids()).toEqual(["c_a", "r_a", "rc_a"]);
    s.push(frame(answer("Hello world", "c_b", "r_b", "rc_b")));
    expect(s.ids()).toEqual(["c_b", "r_b", "rc_b"]);
  });
});

describe("looksLikeId", () => {
  it.each(["c_abc", "r_abc", "rc_abc", "rcdb_abc", "C_ABC"])("treats %s as an id (prefix)", (s) => {
    expect(looksLikeId(s)).toBe(true);
  });

  it("treats a 12+ char hex run as an id", () => {
    expect(looksLikeId("abcdef012345")).toBe(true);
    expect(looksLikeId("abcdef01234")).toBe(false); // 11 chars
  });

  it("treats a 20+ char no-space token as an id", () => {
    expect(looksLikeId("x".repeat(20))).toBe(true);
    expect(looksLikeId("x".repeat(19))).toBe(false);
  });

  it("treats normal prose (has spaces) as NOT an id", () => {
    expect(looksLikeId("The answer is 8 KB pages")).toBe(false);
    expect(looksLikeId("hello")).toBe(false);
  });
});
