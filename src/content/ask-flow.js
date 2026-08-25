// ask-flow.js — the one provider-transport policy wrapper over GA.askService:
// acquire Gemini web-session tokens when (and only when) the web path needs
// them, and retry ONCE on an expired page token (AUTH) after invalidating the
// cache. Extracted from thread-controller's askThread so every ask surface
// (thread turns, the panel's cross-conversation synthesis) shares the exact
// same auth behavior; live-stream registries and session bindings stay with
// the callers that own them.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.askFlow = (function () {
  // ask(prompt, onChunk, { provider }) -> { result: Promise<string>, stop(), abort() }.
  // stop/abort forward to the in-flight service handle — including one created
  // by the AUTH retry after the first handle died. opts.provider (issue #8)
  // answers with another configured provider instead of the site's own; it
  // must have an API key — a web session only works on its own site — so a
  // keyless override fails up front with a pointer to Options.
  function ask(prompt, onChunk, opts) {
    const provider = (opts && opts.provider) || GA.provider;
    const needsGeminiWebTokens =
      provider === "gemini" && GA.provider === "gemini" && !GA.settings.geminiApiKey;
    let inner = null;
    let stopped = false;
    let aborted = false;

    async function once() {
      if (provider !== GA.provider) {
        const def = GA.core.sites.PROVIDERS[provider];
        if (!def || !GA.settings[def.keyField]) {
          const label = (def && def.label) || provider;
          throw new Error("Set a " + label + " API key in Options to answer with " + label + ".");
        }
      }
      const tokens = needsGeminiWebTokens ? await GA.tokenProvider.get() : undefined;
      inner = GA.askService.ask({ provider, prompt, tokens }, onChunk);
      // A stop/abort that raced the async token fetch applies immediately.
      if (stopped) inner.stop();
      if (aborted) inner.abort();
      return inner.result;
    }

    const result = (async () => {
      try {
        return await once();
      } catch (e) {
        if (needsGeminiWebTokens && e && e.code === "AUTH" && !stopped && !aborted) {
          GA.tokenProvider.invalidate();
          return once();
        }
        throw e;
      }
    })();

    return {
      result,
      stop() {
        stopped = true;
        if (inner) inner.stop();
      },
      abort() {
        aborted = true;
        if (inner) inner.abort();
      },
    };
  }

  return { ask };
})();
