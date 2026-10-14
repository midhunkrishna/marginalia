import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

const GA = loadGA(["src/openai/payload.js", "src/openrouter/payload.js"]);
const payload = GA.openrouter.payload;

describe("openrouter payload", () => {
  it("targets OpenRouter's OpenAI-compatible endpoints", () => {
    expect(payload.ENDPOINT).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(payload.LIST_ENDPOINT).toBe("https://openrouter.ai/api/v1/models");
  });

  it("sends bearer auth plus app attribution headers", () => {
    const req = payload.buildRequest("anthropic/claude-sonnet-4.6", "hello", "or-k");
    expect(req.url).toBe(payload.ENDPOINT);
    expect(req.headers).toMatchObject({
      Authorization: "Bearer or-k",
      "Content-Type": "application/json",
      "X-Title": "Marginalia",
    });
    expect(req.headers["HTTP-Referer"]).toMatch(/^https:\/\//);
    const body = JSON.parse(req.body);
    expect(body).toEqual({
      model: "anthropic/claude-sonnet-4.6",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    });
  });

  it("builds a 1-token test request with max_tokens", () => {
    const req = payload.buildTestRequest("m/x", "or-k");
    expect(JSON.parse(req.body)).toEqual({
      model: "m/x",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    });
  });

  it("builds a GET list request without Content-Type", () => {
    const req = payload.buildListRequest("or-k");
    expect(req.url).toBe(payload.LIST_ENDPOINT);
    expect(req.headers.Authorization).toBe("Bearer or-k");
    expect(req.headers).not.toHaveProperty("Content-Type");
    expect(req.body).toBeUndefined();
  });

  it("parseModels keeps every id, flags tool support, sorts newest first", () => {
    const json = {
      data: [
        { id: "a/old", created: 100, supported_parameters: ["tools", "temperature"] },
        { id: "b/new", created: 300, supported_parameters: ["temperature"] },
        { id: "c/mid", created: 200 },
        { id: "d/undated" },
        { nope: 1 },
        null,
      ],
    };
    expect(payload.parseModels(json)).toEqual([
      { id: "b/new", created: 300, tools: false },
      { id: "c/mid", created: 200, tools: false },
      { id: "a/old", created: 100, tools: true },
      { id: "d/undated", created: null, tools: false },
    ]);
    expect(payload.parseModels(null)).toEqual([]);
  });

  it("leaves the OpenAI payload untouched", () => {
    expect(GA.openai.payload.ENDPOINT).toBe("https://api.openai.com/v1/chat/completions");
    expect(GA.openai.payload.headers("k")).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer k",
    });
    expect(GA.openai.payload.buildListRequest("k").headers).toEqual({ Authorization: "Bearer k" });
  });
});

describe("openrouter client", () => {
  it("streams through the OpenAI parser against the OpenRouter endpoint", async () => {
    let seen;
    const sse =
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n: OPENROUTER PROCESSING\n\ndata: [DONE]\n\n';
    const fetchImpl = (url, init) => {
      seen = { url, init };
      const bytes = new TextEncoder().encode(sse);
      let done = false;
      return Promise.resolve({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () => {
              if (done) return Promise.resolve({ done: true });
              done = true;
              return Promise.resolve({ done: false, value: bytes });
            },
            cancel: () => Promise.resolve(),
            releaseLock: () => {},
          }),
        },
      });
    };
    const G = loadGA(
      [
        "src/shared/config.js",
        "src/shared/settings-schema.js",
        "src/shared/stream-delta.js",
        "src/shared/sse.js",
        "src/background/api-util.js",
        "src/background/api-client-factory.js",
        "src/openai/payload.js",
        "src/openai/parser.js",
        "src/openrouter/payload.js",
        "src/openrouter/client.js",
      ],
      { fetch: fetchImpl },
    );
    const chunks = [];
    const out = await G.openrouterClient.ask(
      { settings: { openrouterApiKey: "or-k" }, prompt: "p" },
      (c) => chunks.push(c),
    );
    expect(out).toBe("Hi");
    expect(seen.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(seen.init.body).model).toBe("anthropic/claude-sonnet-4.6");
  });

  it("rejects without a key", async () => {
    const G = loadGA([
      "src/shared/sse.js",
      "src/background/api-client-factory.js",
      "src/openai/payload.js",
      "src/openai/parser.js",
      "src/openrouter/payload.js",
      "src/openrouter/client.js",
    ]);
    await expect(G.openrouterClient.ask({ settings: {} }, () => {})).rejects.toThrow(
      "OpenRouter API key",
    );
  });
});
