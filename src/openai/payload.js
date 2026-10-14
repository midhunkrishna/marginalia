// payload.js — pure request builder for the official OpenAI Chat Completions API.
// No DOM, no network. Used when an OpenAI API key is set (see client.js); the
// reverse-engineered chatgpt.com web client was removed (Cloudflare Turnstile).
// `make(config)` builds the same object for any Chat-Completions-compatible
// endpoint (openrouter/payload.js); the module's own export is make(OpenAI).
var GA = (typeof GA !== "undefined" && GA) || {};
GA.openai = GA.openai || {};

GA.openai.payload = (function () {
  // config:
  //   endpoint, listEndpoint — chat completions POST / model list GET urls
  //   headers(key)           — request headers (auth + Content-Type)
  //   parseModels(json)      — model-list response -> [{id, created, ...}]
  //   testBody(model)        — optional; body object for the "Test" button
  function make(config) {
    const ENDPOINT = config.endpoint;
    const LIST_ENDPOINT = config.listEndpoint;
    const headers = config.headers;

    // `prompt` already carries the full thread context (composed by core/prompt.js).
    function buildBody(model, prompt) {
      return JSON.stringify({
        model: model,
        messages: [{ role: "user", content: prompt || "" }],
        stream: true,
      });
    }

    // Uniform { url, headers, body } shape consumed by the API-client factory.
    function buildRequest(model, prompt, key) {
      return { url: ENDPOINT, headers: headers(key), body: buildBody(model, prompt) };
    }

    // Minimal non-streaming request for the options-page "Test" button. The
    // OpenAI default uses max_completion_tokens (not max_tokens): reasoning
    // models reject max_tokens with HTTP 400, which would read as a false key
    // failure.
    function buildTestRequest(model, key) {
      const body = config.testBody
        ? config.testBody(model)
        : {
            model: model,
            messages: [{ role: "user", content: "ping" }],
            max_completion_tokens: 1,
          };
      return { url: ENDPOINT, headers: headers(key), body: JSON.stringify(body) };
    }

    // GET carries no body, so no Content-Type.
    function buildListRequest(key) {
      const h = Object.assign({}, headers(key));
      delete h["Content-Type"];
      return { url: LIST_ENDPOINT, headers: h };
    }

    return {
      ENDPOINT,
      LIST_ENDPOINT,
      headers,
      buildBody,
      buildRequest,
      buildTestRequest,
      buildListRequest,
      parseModels: config.parseModels,
      make,
    };
  }

  // GET /v1/models response -> [{id, created}], chat-completions-capable only,
  // newest first. The filter is a heuristic over id naming; revisit as vendors
  // rename. NON_CHAT also drops Responses-API-only ids (o1-pro/o3-pro/gpt-5-pro,
  // *-deep-research): they appear in /v1/models but 404 on /v1/chat/completions.
  // "*-search-preview" ids ARE chat-capable, so "search" must not be excluded.
  const CHAT_ID = /^(gpt-|chatgpt-|o\d(-|$))/;
  const NON_CHAT =
    /(audio|realtime|transcribe|tts|image|instruct|moderation|embed|deep-research|-pro(-|$))/;
  function parseModels(json) {
    const data = (json && Array.isArray(json.data) && json.data) || [];
    return data
      .filter((m) => m && typeof m.id === "string" && CHAT_ID.test(m.id) && !NON_CHAT.test(m.id))
      .map((m) => ({ id: m.id, created: typeof m.created === "number" ? m.created : null }))
      .sort((a, b) => (b.created || 0) - (a.created || 0));
  }

  return make({
    endpoint: "https://api.openai.com/v1/chat/completions",
    listEndpoint: "https://api.openai.com/v1/models",
    headers: (key) => ({ "Content-Type": "application/json", Authorization: "Bearer " + key }),
    parseModels,
  });
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.openai.payload;
