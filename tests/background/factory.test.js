import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Drives the real GA.makeApiClient (api-client-factory.js) end-to-end with the
// real per-provider payload/parser modules, against a fake fetch.

function sseStream(chunks, { ok = true, status = 200 } = {}) {
  let i = 0;
  return {
    ok,
    status,
    body: {
      getReader() {
        return {
          read() {
            if (i < chunks.length)
              return Promise.resolve({ value: new TextEncoder().encode(chunks[i++]), done: false });
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    },
  };
}

function recordingFetch(responder) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return typeof responder === "function" ? responder(url, opts) : responder;
  };
  fn.calls = calls;
  return fn;
}

function load(provider, fetchFake) {
  return loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/sse.js",
      "src/background/api-util.js",
      "src/background/api-client-factory.js",
      `src/${provider}/parser.js`,
      `src/${provider}/payload.js`,
      `src/${provider}/client.js`,
    ],
    { fetch: fetchFake },
  );
}

describe("makeApiClient — OpenAI", () => {
  it("streams growing chunks and resolves with the final answer", async () => {
    const fetchFake = recordingFetch(
      sseStream([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n',
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
        "data: [DONE]\n",
      ]),
    );
    const GA = load("openai", fetchFake);
    const chunks = [];
    const out = await GA.openaiClient.ask(
      { prompt: "p", settings: { openaiApiKey: "sk-1", openaiModel: "gpt-4o-mini" } },
      (t) => chunks.push(t),
    );
    expect(out).toBe("Hello");
    expect(chunks[chunks.length - 1]).toBe("Hello");
    const { url, opts } = fetchFake.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(opts.headers.Authorization).toBe("Bearer sk-1");
    expect(JSON.parse(opts.body).model).toBe("gpt-4o-mini");
    expect(opts.signal).toBeDefined(); // request is abortable
  });

  it("throws (without fetching) when the API key is missing", async () => {
    const fetchFake = recordingFetch(sseStream([]));
    const GA = load("openai", fetchFake);
    await expect(GA.openaiClient.ask({ prompt: "p", settings: {} })).rejects.toThrow(
      /OpenAI API key/i,
    );
    expect(fetchFake.calls.length).toBe(0);
  });

  it("missing-key errors carry the B7 trust line", async () => {
    const fetchFake = recordingFetch(sseStream([]));
    const GA = load("openai", fetchFake);
    await expect(GA.openaiClient.ask({ prompt: "p", settings: {} })).rejects.toThrow(
      /stored only in this browser profile/i,
    );
    expect(fetchFake.calls.length).toBe(0);
  });

  it("surfaces the API error message on a non-OK response", async () => {
    const GA = load(
      "openai",
      recordingFetch({
        ok: false,
        status: 429,
        text: async () => '{"error":{"message":"rate limited"}}',
      }),
    );
    await expect(
      GA.openaiClient.ask({ prompt: "p", settings: { openaiApiKey: "k" } }),
    ).rejects.toThrow(/429.*rate limited/);
  });

  it("falls back to the raw body when the error isn't JSON", async () => {
    const GA = load(
      "openai",
      recordingFetch({ ok: false, status: 502, text: async () => "Bad Gateway" }),
    );
    await expect(
      GA.openaiClient.ask({ prompt: "p", settings: { openaiApiKey: "k" } }),
    ).rejects.toThrow(/Bad Gateway/);
  });

  it("uses the schema default model when the setting is blank", async () => {
    const fetchFake = recordingFetch(
      sseStream(['data: {"choices":[{"delta":{"content":"x"}}]}\n', "data: [DONE]\n"]),
    );
    const GA = load("openai", fetchFake);
    await GA.openaiClient.ask({ prompt: "p", settings: { openaiApiKey: "k", openaiModel: "" } });
    expect(JSON.parse(fetchFake.calls[0].opts.body).model).toBe("gpt-4o-mini");
  });

  it("reports a timeout when the request aborts", async () => {
    const GA = load("openai", async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    await expect(
      GA.openaiClient.ask({ prompt: "p", settings: { openaiApiKey: "k" } }),
    ).rejects.toThrow(/timed out/i);
  });

  it("an external cancel (req.signal) surfaces as AbortError, not a timeout", async () => {
    const external = new AbortController();
    const GA = load("openai", (url, opts) => {
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
      GA.openaiClient.ask({
        prompt: "p",
        settings: { openaiApiKey: "k" },
        signal: external.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("makeApiClient — Google AI (key hygiene)", () => {
  it("sends the key in the x-goog-api-key header, never the URL", async () => {
    const fetchFake = recordingFetch(
      sseStream(['data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n']),
    );
    const GA = load("googleai", fetchFake);
    const out = await GA.googleaiClient.ask({
      prompt: "p",
      settings: { geminiApiKey: "AIza-secret", geminiModel: "gemini-2.5-flash" },
    });
    expect(out).toBe("hi");
    const { url, opts } = fetchFake.calls[0];
    expect(opts.headers["x-goog-api-key"]).toBe("AIza-secret");
    expect(url).not.toContain("AIza-secret");
    expect(url).not.toContain("key=");
  });
});

describe("makeApiClient — Anthropic", () => {
  it("sends x-api-key + version headers and parses content_block_delta", async () => {
    const fetchFake = recordingFetch(
      sseStream(['data: {"type":"content_block_delta","delta":{"text":"hi"}}\n']),
    );
    const GA = load("anthropic", fetchFake);
    const out = await GA.anthropicClient.ask({
      prompt: "p",
      settings: { anthropicApiKey: "sk-ant", anthropicModel: "claude-sonnet-4-6" },
    });
    expect(out).toBe("hi");
    const { opts } = fetchFake.calls[0];
    expect(opts.headers["x-api-key"]).toBe("sk-ant");
    expect(opts.headers["anthropic-version"]).toBe("2023-06-01");
  });
});
