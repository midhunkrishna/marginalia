// registry.js — the single source of truth for how a page "provider" (tagged by
// the content script from the host, see core/sites.js) maps to a backend client.
// Adding a provider is a data change here (plus its src/<name>/ files and the
// manifest.json + sw.js script lists) rather than editing dispatch logic.
// clientFor() (background/clients.js) reads this table.
var GA = (typeof GA !== "undefined" && GA) || {};

// apiKeyField — settings key whose presence switches a provider from its
//   logged-in web session to the official API.
// apiClient / webClient — names of the GA.* client objects, resolved lazily by
//   clientFor() so this table doesn't depend on client load order. webClient
//   null = no web fallback (ChatGPT: chatgpt.com is Turnstile-blocked, so it
//   always needs an API key).
GA.PROVIDERS = {
  gemini: {
    apiKeyField: "geminiApiKey",
    apiClient: "googleaiClient",
    webClient: "geminiWebClient",
  },
  chatgpt: { apiKeyField: "openaiApiKey", apiClient: "openaiClient", webClient: null },
  // OpenRouter has no site of its own: API only, reachable from any site's
  // "Answer with" picker and as a research provider.
  openrouter: { apiKeyField: "openrouterApiKey", apiClient: "openrouterClient", webClient: null },
  claude: {
    apiKeyField: "anthropicApiKey",
    apiClient: "anthropicClient",
    webClient: "claudeClient",
  },
};

if (typeof module !== "undefined" && module.exports) module.exports = { PROVIDERS: GA.PROVIDERS };
