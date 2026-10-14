// hosts.js — single source of truth for the four content-site match patterns
// (the AI chat pages the extension runs on). background.js builds the context
// menu's documentUrlPatterns from this list; core/sites.js keys the same sites
// by bare hostname per provider (see the cross-reference comment there).
//
// ⚠️ MANUAL SYNC: manifests are static JSON and cannot read this file, so both
// manifests' content_scripts[0].matches and the content-site half of their
// host_permissions (manifest.json + manifest.chrome.json; host_permissions
// additionally list the four model APIs — OpenAI, Google AI, Anthropic,
// OpenRouter — and Research Mode's two search engines, Brave and DuckDuckGo;
// reading arbitrary pages rides the optional <all_urls> grant) must be kept in
// step by hand.
// tests/build/wiring.test.js asserts the content_scripts matches agree with
// this module.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.hosts = {
  CONTENT_SITE_PATTERNS: [
    "https://gemini.google.com/*",
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
  ],
};

if (typeof module !== "undefined" && module.exports) module.exports = GA.hosts;
