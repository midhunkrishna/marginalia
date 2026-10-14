// copy.js — user-facing copy and links that more than one surface repeats, kept
// in one place so they can't drift: the trust line shown wherever a user pastes
// or debugs an API key (options page, welcome page, key-error cards), and the
// "get a key" / "pricing" links per provider. Loaded by the content scripts,
// the options page and the welcome page (a classic script, no imports).
//
// Hand-copied places that must keep this wording — the store-listing draft in
// ops/instructions.md — are pinned by tests/shared/copy.test.js.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.copy = (function () {
  // One line, one claim: where keys live and where they go. Names every
  // provider a key can reach (AI providers plus the Brave search key).
  const TRUST_LINE =
    "Keys stay in this browser profile and are sent only to the provider you choose " +
    "(OpenAI, Google, Anthropic, OpenRouter or Brave) — never to us; there is no 'us'.";

  // Keyed by provider id (core/sites.js PROVIDERS + the Brave search key). Links
  // only — never prices, which go stale; pricingUrl is the provider's own page.
  // `note` is an optional plain-language remark shown beside the links.
  const PROVIDER_LINKS = {
    chatgpt: {
      keyUrl: "https://platform.openai.com/api-keys",
      pricingUrl: "https://openai.com/api/pricing/",
    },
    gemini: {
      keyUrl: "https://aistudio.google.com/apikey",
      pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing",
      note: "Google AI Studio has a free tier.",
    },
    claude: {
      keyUrl: "https://console.anthropic.com/settings/keys",
      pricingUrl: "https://www.anthropic.com/pricing",
    },
    openrouter: {
      keyUrl: "https://openrouter.ai/keys",
      pricingUrl: "https://openrouter.ai/models",
    },
    brave: {
      keyUrl: "https://api-dashboard.search.brave.com/",
      pricingUrl: "https://brave.com/search/api/",
    },
  };

  // A failure message that is about the user's API key / authorisation rather
  // than the network or the model: an API 401/403, Google's "API key not valid"
  // (a 400), or our own "Add/Set your … API key" prompts. Web-session failures
  // ("Gemini request failed (HTTP 403)") are deliberately NOT key errors.
  const KEY_ERROR_RE =
    /API error \(HTTP (?:401|403)\)|API key not valid|\b(?:add|set)\b[^.]*\bAPI key\b/i;

  // True when `message` should carry the trust line. Total: non-strings are false.
  function isKeyError(message) {
    return typeof message === "string" && KEY_ERROR_RE.test(message);
  }

  // Write the trust line into every [data-trust-line] element under `root`, so
  // the markup holds no copy of its own.
  function fillTrustLines(root) {
    (root || document).querySelectorAll("[data-trust-line]").forEach(function (el) {
      el.textContent = TRUST_LINE;
    });
  }

  return { TRUST_LINE, PROVIDER_LINKS, isKeyError, fillTrustLines };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.copy;
