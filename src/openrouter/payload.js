// payload.js — pure request builder for OpenRouter's OpenAI-compatible Chat
// Completions API. No DOM, no network. Same wire format as OpenAI, so this is
// openai/payload.js's make() with OpenRouter's endpoints, headers and model list
// (requires src/openai/payload.js loaded first).
var GA = (typeof GA !== "undefined" && GA) || {};
GA.openrouter = GA.openrouter || {};

GA.openrouter.payload = GA.openai.payload.make({
  endpoint: "https://openrouter.ai/api/v1/chat/completions",
  listEndpoint: "https://openrouter.ai/api/v1/models",
  // HTTP-Referer/X-Title are OpenRouter's optional app attribution. The referer
  // is the project homepage (manifests carry no homepage_url; same link as the
  // onboarding page).
  headers: (key) => ({
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://github.com/midhunkrishna/marginalia",
    "X-Title": "Marginalia",
  }),
  testBody: (model) => ({
    model: model,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
  }),
  // GET /api/v1/models -> [{id, created, tools}], newest first. No id filter:
  // OpenRouter lists only chat models. `tools` flags function-calling support
  // (research mode needs it).
  parseModels: function (json) {
    const data = (json && Array.isArray(json.data) && json.data) || [];
    return data
      .filter((m) => m && typeof m.id === "string")
      .map((m) => ({
        id: m.id,
        created: typeof m.created === "number" ? m.created : null,
        tools: Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools"),
      }))
      .sort((a, b) => (b.created || 0) - (a.created || 0));
  },
});

if (typeof module !== "undefined" && module.exports) module.exports = GA.openrouter.payload;
