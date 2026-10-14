// quick-actions.js — pure: the one-tap chips shown above the composer of a
// new thread (issue #10). Owns the stored-shape rules (sanitize) and the
// "should chips show for this thread?" rule. The chip's prompt is sent as the
// user's question, so it goes through the normal core/prompt.js strategy — the
// highlight is already the anchor there and `{{selection}}` stays implicit.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.quickActions = (function () {
  const MAX_ACTIONS = 8; // a chip row, not a prompt library
  const MAX_LABEL = 24;
  const MAX_PROMPT = 1000;
  const SELECTION_TOKEN = /\{\{\s*selection\s*\}\}/gi;

  /** Fresh copy of the shipped default chips (never the shared schema array). */
  function defaults() {
    return GA.schema.DEFAULT_SETTINGS.quickActions.map((a) => Object.assign({}, a));
  }

  /** Trim a value to a string no longer than `max` ("" for non-strings). */
  function clean(v, max) {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
  }

  /** A usable, unique id: the stored one when valid and unseen, else `qa-<n>`. */
  function uniqueId(raw, seen) {
    let id = clean(raw, 40);
    for (let n = seen.size + 1; !id || seen.has(id); n++) id = "qa-" + n;
    seen.add(id);
    return id;
  }

  /**
   * Coerce whatever storage holds into a valid chip list: non-arrays fall back
   * to the defaults; entries without a label or prompt are dropped; ids are
   * made unique; lengths and count are capped. An empty array is honored (the
   * user removed every chip).
   */
  function sanitizeQuickActions(raw) {
    if (!Array.isArray(raw)) return defaults();
    const seen = new Set();
    const out = [];
    for (const item of raw) {
      if (out.length >= MAX_ACTIONS) break;
      if (!item || typeof item !== "object") continue;
      const label = clean(item.label, MAX_LABEL);
      const prompt = clean(item.prompt, MAX_PROMPT);
      if (!label || !prompt) continue;
      out.push({ id: uniqueId(item.id, seen), label, prompt });
    }
    return out;
  }

  /** Make `{{selection}}` read naturally: the highlight is already the anchor. */
  function resolvePrompt(prompt) {
    return prompt.replace(SELECTION_TOKEN, "the highlighted text");
  }

  /**
   * Chips to offer for `thread`: only a fresh, open question thread (no
   * messages yet, not resolved, not a standalone label) gets any. Returns
   * [{id, label, prompt}] with prompts ready to send.
   */
  function quickActionsFor(thread, settings) {
    if (!thread || thread.resolved || thread.kind === "label") return [];
    if (thread.messages && thread.messages.length) return [];
    return sanitizeQuickActions(settings && settings.quickActions).map((a) =>
      Object.assign({}, a, { prompt: resolvePrompt(a.prompt) }),
    );
  }

  return { quickActionsFor, sanitizeQuickActions, defaults, MAX_ACTIONS, MAX_LABEL, MAX_PROMPT };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.quickActions;
