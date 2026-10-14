// client.js — OpenRouter strategy implementing the shared client interface
// `{ ask(req, onChunk) -> Promise<string> }`. API only (no site of its own).
// OpenRouter streams OpenAI-format SSE, so the OpenAI parser is reused as is.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.openrouterClient = GA.makeApiClient({
  label: "OpenRouter",
  apiKeyField: "openrouterApiKey",
  modelField: "openrouterModel",
  missingKeyMsg: "Add your OpenRouter API key in the extension's settings.",
  buildRequest: GA.openrouter.payload.buildRequest,
  makeStream: GA.openai.parser.makeStream,
});

if (typeof module !== "undefined" && module.exports) module.exports = GA.openrouterClient;
