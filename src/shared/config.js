// config.js — named timing/size constants for the content-script shell, so the
// magic numbers live in one labelled place. (Layout-algorithm constants live with
// the algorithm in core/layout-engine.js; anchor context size in core/anchor-match.)
var GA = (typeof GA !== "undefined" && GA) || {};

GA.config = {
  TOKEN_CACHE_TTL_MS: 60000, // re-scrape session tokens at most this often
  // Heartbeat/watchdog contract (both halves live here so they can't drift):
  // background.js posts a port ping every PING_INTERVAL_MS while an ask
  // streams (any port message resets Chrome's 30s MV3 service-worker idle
  // timer), and the content side abandons the ask if the port stays silent
  // for ASK_WATCHDOG_MS. INVARIANT: ASK_WATCHDOG_MS must comfortably exceed
  // PING_INTERVAL_MS (several missed pings), so only a dead worker trips it.
  PING_INTERVAL_MS: 20000, // background heartbeat cadence while streaming
  ASK_WATCHDOG_MS: 90000, // content-side ask abandoned after this much port silence
  REANCHOR_RETRY_MS: [400, 1000, 2200, 4000, 6500], // post-load re-anchor attempts (lazy hydration)
  SECTION_CHARS: 4000, // max chars of answer-section context sent to Gemini
  CONVERSATION_CHARS: 12000, // max chars of whole-conversation context
  TOAST_MS: 2600, // toast visible duration
  SNIPPET_CHARS: 60, // highlighted-text snippet length in a box header
  MODAL_SNIPPET_CHARS: 120, // modal header snippet — the wider surface fits more context
  PANEL_SNIPPET_CHARS: 70, // panel row highlight snippet — shorter than the modal's, two lines per row
  PANEL_QUESTION_CHARS: 90, // panel row first-question preview length
  PANEL_BADGE_CHARS: 28, // conversation-title badge on All-chats rows — a badge, not a headline
  PANEL_OUTLINE_CHARS: 80, // Outline row: first N chars of the prompt — a landmark, not the prompt
  COPY_FEEDBACK_MS: 1500, // a copy button shows the check icon this long before reverting
  SECTION_MIN_CHARS: 200, // fallback section walk: smallest block that counts as an answer "section"
  CONVO_CAPTURE_DEBOUNCE_MS: 1200, // transcript capture runs this long after the last settle ping
  TEXTAREA_MAX_PX: 120, // composer auto-grow cap FLOOR (small viewports)
  TEXTAREA_GROW_MAX_FRAC: 0.4, // …but up to this fraction of the viewport, so
  // everything the user typed stays visible while the box grows upward
  COMPOSER_MANUAL_MIN_PX: 60, // drag-resized composer floor (modal grip)
  COMPOSER_MANUAL_MAX_FRAC: 0.5, // drag-resized composer ceiling, fraction of viewport height
  MODAL_MIN_PX: 420, // drag-resize floor for the thread modal
  MODAL_MAX_FRAC: 0.95, // drag-resize ceiling as a fraction of the viewport width
  MODAL_FALLBACK_PX: 820, // drag-start width when the modal has no measurable width yet (first paint / jsdom)
  PANEL_FALLBACK_PX: 560, // panel drag-start width fallback (matches the CSS min(560px, 100%))
  PANEL_MIN_H_PX: 320, // panel height drag floor — header + a few rows + the footer
  PANEL_MAX_H_FRAC: 0.9, // panel height ceiling — matches .ga-modal's max-height: 90vh
  PANEL_FALLBACK_H_PX: 520, // drag-start height when the panel has no measurable height yet (first paint / jsdom)
  BOX_MESSAGES_MIN_PX: 40, // layout clamp floor — a squeezed box keeps at least a sliver of messages visible
  CALM_SCROLL_BUDGET_PX: 60, // calm scrolling: follow ~3 lines of a new answer, then hold still
  STREAM_RENDER_SMALL_CHARS: 2048, // answers below this render every frame (snappy start)
  STREAM_RENDER_MAX_MS: 70, // longer answers batch renders to one per this window
  BUNDLE_ITEM_CHARS: 8000, // max chars each selected item contributes to a cross-conversation prompt
  // Research mode (background tool loop; see background/research-loop.js):
  RESEARCH_TOOL_TIMEOUT_MS: 20000, // one web_search / read_page fetch
  RESEARCH_RUN_TIMEOUT_MS: 300000, // whole run — past this the model is told to answer now
  READ_PAGE_MAX_BYTES: 1500000, // stop reading a page body past this many bytes
  READ_PAGE_MAX_CHARS: 12000, // extracted page text handed to the model
  SEARCH_MAX_RESULTS: 8, // results per web_search call
  SEARCH_SNIPPET_CHARS: 300, // per-result snippet cap
  RESEARCH_SOURCE_TITLE_CHARS: 120, // source titles stored on the reply
};

if (typeof module !== "undefined" && module.exports) module.exports = GA.config;
