// tools.js — research-mode tool-calling adapter for OpenRouter. Same wire
// format as OpenAI, so this is openai/tools.js's make() pointed at OpenRouter
// (requires src/openai/tools.js loaded first; the payload is looked up lazily).
var GA = (typeof GA !== "undefined" && GA) || {};
GA.openrouter = GA.openrouter || {};

GA.openrouter.tools = GA.openai.tools.make({
  label: "OpenRouter",
  endpoint: () => GA.openrouter.payload.ENDPOINT,
  headers: (key) => GA.openrouter.payload.headers(key),
});

if (typeof module !== "undefined" && module.exports) module.exports = GA.openrouter.tools;
