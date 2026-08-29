// api-client-factory.js — builds the official-API clients (OpenAI, Google AI,
// Anthropic), which all share one shape: validate the key, POST the request the
// provider's payload.js builds, then stream the SSE reply via api-util.js. Only
// the per-provider bits vary (which key/model setting, endpoint, headers, body,
// SSE extractor), so each src/<provider>/client.js is now just a config object
// passed here. See background/registry.js for how a provider maps to a client.
var GA = (typeof GA !== "undefined" && GA) || {};

// config:
//   label        — human name used in error messages ("OpenAI")
//   apiKeyField  — settings key holding the API key ("openaiApiKey")
//   modelField   — settings key holding the model ("openaiModel"); the default
//                  comes from settings-schema.js so it lives in exactly one place
//   missingKeyMsg— thrown when the key isn't set
//   buildRequest(model, prompt, key) -> { url, headers, body }
//   makeStream() -> incremental parser cursor {push, end} (see shared/sse.js)
GA.makeApiClient = function (config) {
  async function ask(req, onChunk) {
    const s = (req && req.settings) || {};
    const key = s[config.apiKeyField];
    if (!key) {
      // Key-missing errors surface the trust story (B7): the card names the
      // failure AND reassures the user at the moment the key fear peaks.
      const trust = (GA.schema && GA.schema.TRUST_LINE) || "";
      throw new Error(trust ? config.missingKeyMsg + "\n" + trust : config.missingKeyMsg);
    }
    // Guard the empty-string case (a user who cleared the model field) so we
    // never POST model:"". Defaults are defined only in settings-schema.js.
    const schemaDefault =
      GA.schema && GA.schema.DEFAULT_SETTINGS && GA.schema.DEFAULT_SETTINGS[config.modelField];
    const model = s[config.modelField] || schemaDefault;
    const built = config.buildRequest(model, (req && req.prompt) || "", key);

    const budget = GA.makeAbortBudget(GA.REQUEST_TIMEOUT_MS, req && req.signal);
    const timeoutMsg = config.label + " request timed out.";
    let res;
    try {
      res = await fetch(built.url, {
        method: "POST",
        headers: built.headers,
        body: built.body,
        signal: budget.signal,
      });
    } catch (e) {
      budget.clear();
      throw GA.mapBudgetError(e, budget, timeoutMsg);
    }
    if (!res.ok) {
      budget.clear();
      throw new Error(await GA.apiError(config.label, res));
    }
    try {
      const failMsg =
        "Couldn't parse " + config.label + "'s response — the API shape may have changed.";
      return await GA.streamText(res, config.makeStream(), onChunk, failMsg, budget);
    } catch (e) {
      throw GA.mapBudgetError(e, budget, timeoutMsg);
    } finally {
      budget.clear();
    }
  }
  return { ask };
};

if (typeof module !== "undefined" && module.exports)
  module.exports = { makeApiClient: GA.makeApiClient };
