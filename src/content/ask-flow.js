// ask-flow.js — the one provider-transport policy wrapper over GA.askService:
// acquire Gemini web-session tokens when (and only when) the web path needs
// them, and retry ONCE on an expired page token (AUTH) after invalidating the
// cache. Extracted from thread-controller's askThread so every ask surface
// (thread turns, the panel's cross-conversation synthesis) shares the exact
// same auth behavior; live-stream registries and session bindings stay with
// the callers that own them.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.askFlow = (function () {
  // ask(prompt, onChunk, { provider, research, onStep }) ->
  //   { result: Promise<string | {text, research}>, stop(), abort() }.
  // stop/abort forward to the in-flight service handle — including one created
  // by the AUTH retry after the first handle died. opts.provider (issue #8)
  // answers with another configured provider instead of the site's own; it
  // must have an API key — a web session only works on its own site — so a
  // keyless override fails up front with a pointer to Options.
  //
  // opts.research runs the background's research loop instead: the provider is
  // the one picked in Options (the background ignores `provider`), so no web
  // tokens and no keyless-override check — only "is a research provider set
  // up?". opts.onStep receives the live progress steps. result then resolves
  // {text, research} (see ask-service.js).
  //
  // opts.session / opts.onSession (Gemini web path only, ignored elsewhere):
  // continue an existing Gemini conversation and learn the ids of the one that
  // answered, so a thread reuses one sidebar chat instead of opening one per ask.
  function ask(prompt, onChunk, opts) {
    const research = !!(opts && opts.research);
    const onStep = opts && opts.onStep;
    const provider = (opts && opts.provider) || GA.provider;
    const needsGeminiWebTokens =
      !research && provider === "gemini" && GA.provider === "gemini" && !GA.settings.geminiApiKey;
    let inner = null;
    let stopped = false;
    let aborted = false;

    async function once() {
      if (research) {
        if (!GA.core.sites.researchOption(GA.settings))
          throw new Error("Pick a research provider in Marginalia's options.");
        inner = GA.askService.ask({ provider, prompt, research: true }, onChunk, onStep);
        if (stopped) inner.stop();
        if (aborted) inner.abort();
        return inner.result;
      }
      if (provider !== GA.provider) {
        const def = GA.core.sites.PROVIDERS[provider];
        if (!def || !GA.settings[def.keyField]) {
          const label = (def && def.label) || provider;
          throw new Error("Set a " + label + " API key in Options to answer with " + label + ".");
        }
      }
      const tokens = needsGeminiWebTokens ? await GA.tokenProvider.get() : undefined;
      const req = { provider, prompt, tokens };
      if (needsGeminiWebTokens && opts && opts.session) req.session = opts.session;
      if (needsGeminiWebTokens && opts && opts.onSession) req.onSession = opts.onSession;
      inner = GA.askService.ask(req, onChunk);
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
