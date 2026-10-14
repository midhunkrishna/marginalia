// settings-schema.js — single source of truth for stored-data keys and the
// settings defaults. Shared by content scripts (util.js, store.js) and the
// options page so the schema can't drift between contexts.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.schema = {
  SETTINGS_KEY: "ga:settings",
  THREADS_PREFIX: "ga:threads:", // storage.local key prefix, one bucket per session
  CONVO_PREFIX: "ga:convo:", // transcript record per session (per-message gzip blobs)
  DRAFT_SESSION: "__draft__", // bucket for threads created before /app/<id> exists

  DEFAULT_SETTINGS: {
    // Context sent with each follow-up: 'section' | 'selection' | 'conversation'
    scope: "section",
    // Configurable shortcut to open a comment box (Ctrl+H is reserved by Firefox).
    shortcut: { ctrl: true, shift: true, alt: false, meta: false, key: "h" },
    // Show the floating "Comment" pill when text is selected in an answer.
    adder: true,
    debug: false,
    // Calm scrolling: while an answer streams, follow only the first few lines
    // then hold still — a scroll-down button marks the content growing below.
    calmScroll: false,
    // Optional per-provider API keys. When a key is set, that site's follow-ups go
    // through the official API instead of the logged-in web session. Empty = web
    // session (ChatGPT has no web fallback, so it needs a key). Models are free-text
    // because vendors rename/retire ids over time.
    openaiApiKey: "",
    openaiModel: "gpt-4o-mini",
    geminiApiKey: "",
    geminiModel: "gemini-2.5-flash",
    anthropicApiKey: "",
    anthropicModel: "claude-sonnet-4-6",
    // OpenRouter: API-only (no site), usable in the "Answer with" picker and
    // as a research provider. Model ids are OpenRouter's "vendor/model" slugs.
    openrouterApiKey: "",
    openrouterModel: "anthropic/claude-sonnet-4.6",
    // Research mode. researchProvider is an options-row id ("" | "openai" |
    // "gemini" | "anthropic" | "openrouter"); the row's key must be set.
    researchProvider: "",
    searchProvider: "ddg", // "ddg" (no key) | "brave"
    searchApiKey: "",
    researchMaxSteps: 8, // model turns per run (2–15)
    researchMaxSearches: 5, // web_search calls per run (0–10)
    researchMaxPages: 3, // read_page calls per run (0–8)
    // Quick-action chips shown above the composer of a new, empty thread
    // (issue #10). Tap = send; the highlight is the anchor, so a prompt never
    // needs to quote it — `{{selection}}` is optional sugar for "the highlighted
    // text". Editable in Options; sanitized by core/quick-actions.js on read.
    quickActions: [
      { id: "explain", label: "Explain", prompt: "Explain this in clear, simple terms." },
      { id: "eli5", label: "ELI5", prompt: "Explain this like I'm five." },
      {
        id: "sources",
        label: "Sources?",
        prompt:
          "What sources or evidence back this up? Flag anything uncertain or that you can't verify.",
      },
      {
        id: "counter",
        label: "Counter-argument",
        prompt: "What is the strongest counter-argument to this?",
      },
    ],
  },
};

if (typeof module !== "undefined" && module.exports) module.exports = GA.schema;
