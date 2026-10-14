import { describe, it, expect, vi } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// --- helpers to build a scripted StreamGenerate stream -----------------------
const PREFIX = ")]}'" + "\n\n";
function frame(text, ids = ["c_x", "r_x", "rc_x"]) {
  const body = [null, [ids[0], ids[1]], null, null, [[ids[2], [text]]]];
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
  it("emits growing chunks and resolves with the final answer", async () => {
    const stream = streamResponse([PREFIX + frame("Hel"), frame("Hello world")]);
    const client = clientWith(async () => stream);
    const chunks = [];
    const out = await client.ask({ prompt: "p", tokens }, (t) => chunks.push(t));
    expect(out).toBe("Hello world");
    expect(chunks[chunks.length - 1]).toBe("Hello world");
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

describe("client.ask conversation session", () => {
  const session = { c: "c_old", r: "r_old", rc: "rc_old" };
  // The triplet a recorded fetch call sent.
  const sentTriplet = (call) =>
    JSON.parse(JSON.parse(new URLSearchParams(call[1].body).get("f.req"))[1])[2];

  it("sends the session ids in the triplet and reports the reply's ids via onSession", async () => {
    const calls = [];
    const client = clientWith(async (...a) => {
      calls.push(a);
      return streamResponse([PREFIX + frame("Hi", ["c_old", "r_new", "rc_new"])]);
    });
    const onSession = vi.fn();
    const out = await client.ask({ prompt: "p", tokens, session, onSession });
    expect(out).toBe("Hi");
    expect(sentTriplet(calls[0])).toEqual(["c_old", "r_old", "rc_old"]);
    expect(onSession).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenCalledWith({ c: "c_old", r: "r_new", rc: "rc_new" });
  });

  it("starts a new conversation (empty triplet) with no session and still reports ids", async () => {
    const calls = [];
    const client = clientWith(async (...a) => {
      calls.push(a);
      return streamResponse([PREFIX + frame("Hi")]);
    });
    const onSession = vi.fn();
    await client.ask({ prompt: "p", tokens, onSession });
    expect(sentTriplet(calls[0])).toEqual([null, null, null]);
    expect(onSession).toHaveBeenCalledWith({ c: "c_x", r: "r_x", rc: "rc_x" });
  });

  it("does not call onSession when the reply carries no ids", async () => {
    const noIds = JSON.stringify([
      ["wrb.fr", "f", JSON.stringify([null, null, null, null, [["zz", ["Hi"]]]])],
    ]);
    const client = clientWith(async () => streamResponse([PREFIX + noIds + "\n"]));
    const onSession = vi.fn();
    expect(await client.ask({ prompt: "p", tokens, onSession })).toBe("Hi");
    expect(onSession).not.toHaveBeenCalled();
  });

  it("retries once without ids when a request that sent ids fails, and reports the new ids", async () => {
    const calls = [];
    const client = clientWith(async (...a) => {
      calls.push(a);
      if (calls.length === 1) return streamResponse([], { ok: false, status: 400 });
      return streamResponse([PREFIX + frame("Fresh", ["c_new", "r_new", "rc_new"])]);
    });
    const onSession = vi.fn();
    const out = await client.ask({ prompt: "p", tokens, session, onSession });
    expect(out).toBe("Fresh");
    expect(calls).toHaveLength(2);
    expect(sentTriplet(calls[0])).toEqual(["c_old", "r_old", "rc_old"]);
    expect(sentTriplet(calls[1])).toEqual([null, null, null]);
    expect(onSession).toHaveBeenCalledWith({ c: "c_new", r: "r_new", rc: "rc_new" });
  });

  it("retries without ids when the reply of an id-bearing request can't be parsed", async () => {
    let n = 0;
    const client = clientWith(async () =>
      ++n === 1 ? streamResponse(["garbage"]) : streamResponse([PREFIX + frame("ok")]),
    );
    expect(await client.ask({ prompt: "p", tokens, session })).toBe("ok");
    expect(n).toBe(2);
  });

  it("retries at most once — a second failure propagates", async () => {
    let n = 0;
    const client = clientWith(async () => {
      n++;
      return streamResponse([], { ok: false, status: 500 });
    });
    await expect(client.ask({ prompt: "p", tokens, session })).rejects.toThrow(/500/);
    expect(n).toBe(2);
  });

  it("does not retry a request that sent no ids", async () => {
    let n = 0;
    const client = clientWith(async () => {
      n++;
      return streamResponse([], { ok: false, status: 500 });
    });
    await expect(client.ask({ prompt: "p", tokens })).rejects.toThrow(/500/);
    expect(n).toBe(1);
  });

  it("does not retry an AUTH failure", async () => {
    let n = 0;
    const client = clientWith(async () => {
      n++;
      return streamResponse([], { ok: false, status: 401 });
    });
    await expect(client.ask({ prompt: "p", tokens, session })).rejects.toMatchObject({
      code: "AUTH",
    });
    expect(n).toBe(1);
  });

  it("does not retry an external cancel", async () => {
    const external = new AbortController();
    let n = 0;
    const client = clientWith((url, opts) => {
      n++;
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
        external.abort();
      });
    });
    await expect(
      client.ask({ prompt: "p", tokens, session, signal: external.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(n).toBe(1);
  });

  it("ignores a malformed session instead of sending it (and does not retry on it)", async () => {
    const calls = [];
    const client = clientWith(async (...a) => {
      calls.push(a);
      return streamResponse([], { ok: false, status: 500 });
    });
    await expect(client.ask({ prompt: "p", tokens, session: { c: "c_1" } })).rejects.toThrow(/500/);
    expect(calls).toHaveLength(1);
    expect(sentTriplet(calls[0])).toEqual([null, null, null]);
  });
});
