// prompt.js — pure: compose the single prompt sent to the active provider
// (Gemini, ChatGPT, Claude, …) for a follow-up. The amount of surrounding
// context is chosen by a Strategy keyed on `scope`.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.prompt = (function () {
  // Context-scope Strategy: each returns the context string for a thread.
  // `deps.conversationText` is supplied by the caller only for 'conversation'.
  const SCOPE = {
    selection: (thread) => thread.selector.exact,
    section: (thread) => thread.section || thread.selector.exact,
    conversation: (thread, deps) =>
      (deps && deps.conversationText) || thread.section || thread.selector.exact,
  };

  // `providerLabel` is the display name of the SITE's model — the author of
  // the answer being discussed (from the core/sites.js registry, e.g.
  // "Gemini"); omitted → neutral wording.
  // `asked` (optional, issue #8) = { id, label, siteId } when a DIFFERENT
  // provider answers this follow-up: the site's model is then named in the
  // third person, and earlier replies in the thread are attributed to
  // whoever wrote them ("You:" only for the provider now being asked).
  function composePrompt(thread, scope, deps, providerLabel, asked) {
    const pick = SCOPE[scope] || SCOPE.section;
    const context = pick(thread, deps);
    const cross = !!(asked && asked.id && asked.id !== asked.siteId);
    const who = cross
      ? providerLabel || "another AI"
      : providerLabel
        ? "you (" + providerLabel + ")"
        : "you";
    const speaker = (m) => {
      if (m.role === "user") return "Me: ";
      if (!cross) return "You: ";
      const by = m.provider || asked.siteId;
      if (by === asked.id) return "You: ";
      return (by === asked.siteId && providerLabel ? providerLabel : String(by)) + ": ";
    };
    const lines = [];
    lines.push("I'm reading an answer " + who + " gave me. Relevant context:");
    lines.push('"""');
    lines.push(context);
    lines.push('"""');
    lines.push("");
    lines.push('I highlighted this specific part: "' + thread.selector.exact + '"');
    lines.push("");
    lines.push("Our follow-up discussion so far:");
    (thread.messages || [])
      .filter((m) => !m.error) // failed-request notices aren't part of the conversation
      .forEach((m) => {
        lines.push(speaker(m) + m.text);
      });
    lines.push("");
    lines.push(
      "Answer my latest question concisely, focused only on the highlighted part. " +
        "Don't repeat the whole original explanation.",
    );
    return lines.join("\n");
  }

  return { composePrompt, SCOPE };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.prompt;
