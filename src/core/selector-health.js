// selector-health.js — pure verdict on whether a site's DOM selectors still
// match anything. Host sites redesign without notice; the dangerous failure is
// the SILENT one (pills just stop appearing), so the content script feeds the
// match counts here and shows a one-time hint when a tier stays dead.
//
// Tiers, in the vocabulary of core/sites.js:
//   "user"     — turns.user selectors (questions)
//   "model"    — turns.model selectors (answers, outermost containers)
//   "response" — responseSelectors (the wider answer-container fallbacks)
//   "all"      — nothing matched at all
// No DOM, no timers: unit-tested in tests/core/selector-health.test.js.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.selectorHealth = (function () {
  const ISSUES_URL = "https://github.com/midhunkrishna/marginalia/issues/new";

  // The first tier with zero matches ("all" when every tier is dead), or null
  // when every tier matches. `counts` = { user, model, response } (numbers).
  function failedTier(counts) {
    const dead = ["user", "model", "response"].filter((t) => !counts[t]);
    if (dead.length === 0) return null;
    return dead.length === 3 ? "all" : dead[0];
  }

  // Judge one observation.
  //   sessionId      — open conversation id; null = new chat, nothing to match yet
  //   turnCounts     — { user, model } matches of the turn selectors
  //   responseCounts — total matches of the responseSelectors
  //   elapsedMs      — time this conversation has been under observation
  //   threshold      — grace period for slow hydration before declaring "broken"
  // -> { status: "ok" | "pending" | "broken", tier: string | null }
  function evaluate(obs) {
    if (!obs.sessionId) return { status: "ok", tier: null };
    const turns = obs.turnCounts || {};
    const tier = failedTier({
      user: turns.user || 0,
      model: turns.model || 0,
      response: obs.responseCounts || 0,
    });
    if (!tier) return { status: "ok", tier: null };
    return { status: obs.elapsedMs >= obs.threshold ? "broken" : "pending", tier };
  }

  // A prefilled new-issue URL so a user can report a dead selector in two
  // clicks. No page content is included — only site, tier and extension version.
  function reportUrl(info) {
    const provider = info.provider || "unknown";
    const tier = info.tier || "unknown";
    const version = info.version || "unknown";
    const title = "Selector health: " + provider + " (" + tier + " selectors match nothing)";
    const body = [
      "Marginalia reported that it can't find answers on this page.",
      "",
      "- Site: " + provider,
      "- Failed selector tier: " + tier,
      "- Extension version: " + version,
      "",
      "What did the site look like when this happened (redesign, new layout, logged out)?",
    ].join("\n");
    return ISSUES_URL + "?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body);
  }

  return { evaluate, reportUrl, failedTier };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.selectorHealth;
