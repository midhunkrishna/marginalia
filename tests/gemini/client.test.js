import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// --- helpers to build a scripted StreamGenerate stream -----------------------
const PREFIX = ")]}'" + "\n\n";
function frame(text) {
  const body = [null, ["c_x", "r_x"], null, null, [["rc_x", [text]]]];
  const item = ["wrb.fr", "f.abc", JSON.stringify(body), null, null, null, "generic"];
  const line = JSON.stringify([item]);
  return line.length + "\n" + line + "\n";
}
function streamResponse(textChunks, { ok = true, status = 200 } = {}) {
  let i = 0;
  return {
    ok,
    status,
    body: {
      getReader() {
        return {
          read() {
            if (i < textChunks.length)
              return Promise.resolve({
                value: new TextEncoder().encode(textChunks[i++]),
                done: false,
              });
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    },
  };
}

function clientWith(fetchFake) {
  // api-util.js supplies GA.makeAbortBudget / GA.REQUEST_TIMEOUT_MS used by the
  // client's request-timeout guard.
  return loadGA(
    [
      "src/background/api-util.js",
      "src/gemini/parser.js",
      "src/gemini/payload.js",
      "src/gemini/client.js",
    ],
    { fetch: fetchFake },
  ).geminiWebClient;
}

const tokens = { at: "AT", bl: "boq", sid: "99" };

describe("client.ask (WebRpcClient transport + streaming)", () => {
  it("emits growing chunks and resolves with the final answer and conversation ids", async () => {
    const stream = streamResponse([PREFIX + frame("Hel"), frame("Hello world")]);
    const client = clientWith(async () => stream);
    const chunks = [];
    const out = await client.ask({ prompt: "p", tokens }, (t) => chunks.push(t));
    expect(out.text).toBe("Hello world");
    expect(out.ids).toEqual(["c_x", "r_x", "rc_x"]);
    expect(chunks[chunks.length - 1]).toBe("Hello world");
  });

  it("returns plain text when the stream carries no conversation ids", async () => {
    // frame() always includes ids, so build a body without body[1].
    const noIds = [null, null, null, null, [["rc_x", ["Plain answer."]]]];
    const item = ["wrb.fr", "f.abc", JSON.stringify(noIds), null, null, null, "generic"];
    const line = JSON.stringify([item]);
    const raw = PREFIX + line.length + "\n" + line + "\n";
    const client = clientWith(async () => streamResponse([raw]));
    const out = await client.ask({ prompt: "p", tokens }, () => {});
    expect(out).toBe("Plain answer.");
  });

  it("reuses caller-provided conversation ids in the request body", async () => {
    let seen = null;
    const client = clientWith(async (url, opts) => {
      seen = new URLSearchParams(opts.body);
      return streamResponse([PREFIX + frame("ok")]);
    });
    await client.ask({ prompt: "p", tokens, ids: ["c_prev", "r_prev", "rc_prev"] }, () => {});
    const inner = JSON.parse(JSON.parse(seen.get("f.req"))[1]);
    expect(inner[2]).toEqual(["c_prev", "r_prev", "rc_prev"]);
  });

  it("throws before fetching when the session token is missing", async () => {
    let fetched = false;
    const client = clientWith(async () => {
      fetched = true;
      return streamResponse([]);
    });
    await expect(client.ask({ prompt: "p", tokens: {} })).rejects.toThrow(/session token/i);
    expect(fetched).toBe(false);
  });

  it("throws on a non-OK HTTP response", async () => {
    const client = clientWith(async () => streamResponse([], { ok: false, status: 429 }));
    await expect(client.ask({ prompt: "p", tokens })).rejects.toThrow(/429/);
  });

  it("tags auth failures with code=AUTH so the caller can refresh tokens", async () => {
    const client = clientWith(async () => streamResponse([], { ok: false, status: 401 }));
    await expect(client.ask({ prompt: "p", tokens })).rejects.toMatchObject({ code: "AUTH" });
    const client2 = clientWith(async () => streamResponse([], { ok: false, status: 429 }));
    await expect(client2.ask({ prompt: "p", tokens })).rejects.not.toMatchObject({ code: "AUTH" });
  });

  it("throws when the response can't be parsed", async () => {
    const client = clientWith(async () => streamResponse(["totally not batchexecute"]));
    await expect(client.ask({ prompt: "p", tokens })).rejects.toThrow(/internal API shape/i);
  });

  it("an external cancel (req.signal) surfaces as AbortError, not a timeout", async () => {
    const external = new AbortController();
    const client = clientWith((url, opts) => {
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
        external.abort(); // cancel while the request is pending
      });
    });
    await expect(
      client.ask({ prompt: "p", tokens, signal: external.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
