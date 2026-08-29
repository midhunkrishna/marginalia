// ask-flow.js — the one provider-transport policy wrapper over GA.askService:
// acquire Gemini web-session tokens when (and only when) the web path needs
// them, and retry ONCE on an expired page token (AUTH) after invalidating the
// cache. Extracted from thread-controller's askThread so every ask surface
// (thread turns, the panel's cross-conversation synthesis) shares the exact
// same auth behavior; live-stream registries and session bindings stay with
// the callers that own them.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.askFlow = (function () {
  // ask(prompt, onChunk, ids) -> { result: Promise<string|{text,ids}>, stop(), abort() }.
  // stop/abort forward to the in-flight service handle — including one created
  // by the AUTH retry after the first handle died. `ids` is the Gemini
  // conversation triplet from a previous reply; passing it keeps follow-ups in
  // one hidden side-conversation instead of spawning a sidebar chat per ask.
  function ask(prompt, onChunk, ids) {
    const needsGeminiWebTokens = GA.provider === "gemini" && !GA.settings.geminiApiKey;
    let inner = null;
    let stopped = false;
    let aborted = false;

    async function once() {
      const tokens = needsGeminiWebTokens ? await GA.tokenProvider.get() : undefined;
      inner = GA.askService.ask({ provider: GA.provider, prompt, tokens, ids }, onChunk);
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
