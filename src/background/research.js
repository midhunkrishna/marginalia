// research.js — entry point for a Research Mode turn (MSG_ASK with
// research:true). Resolves the configured research provider, its key/model and
// the run's limits, checks the optional page-read permission, then hands the
// run to research-loop.js with the tools from research-tools.js. The content
// side's msg.provider is ignored: settings.researchProvider decides.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.research = (function () {
  // Adapter per registry id; the options-row ids come from sites.RESEARCH_ROWS.
  const ADAPTERS = {
    chatgpt: () => GA.openai.tools,
    gemini: () => GA.googleai.tools,
    claude: () => GA.anthropic.tools,
    openrouter: () => GA.openrouter.tools,
  };

  // Keyed by options-row id, like key-test.js's PROVIDERS (a test pins the two
  // key sets equal). Labels/fields come from core/sites.js so there is one
  // source of truth; built on first use, never at load time.
  function buildProviders() {
    const sites = GA.core.sites;
    const out = {};
    for (const rowId of Object.keys(sites.RESEARCH_ROWS)) {
      const registryId = sites.RESEARCH_ROWS[rowId];
      const def = sites.PROVIDERS[registryId];
      out[rowId] = {
        registryId,
        label: def.label,
        keyField: def.keyField,
        modelField: def.modelField,
        adapter: ADAPTERS[registryId],
      };
    }
    return out;
  }
  let providers = null;
  function getProviders() {
    return providers || (providers = buildProviders());
  }

  async function canReadPages() {
    try {
      return !!(await browser.permissions.contains({ origins: ["<all_urls>"] }));
    } catch (e) {
      return false;
    }
  }

  // -> {text, research:{provider, model, steps, searches, pages, sources}}
  async function run(opts) {
    const o = opts || {};
    const settings = o.settings || {};
    const option = GA.core.sites.researchOption(settings);
    const provider = option && getProviders()[option.rowId];
    if (!provider) throw new Error("Pick a research provider in Marginalia's options.");
    const key = String(settings[provider.keyField] || "").trim();
    if (!key) throw new Error("Add your " + provider.label + " API key in Marginalia's options.");
    const model = String(settings[provider.modelField] || "").trim();
    if (!model) throw new Error("Set a " + provider.label + " model in Marginalia's options.");

    const R = GA.core.research;
    const limits = R.clampLimits(settings);
    const canRead = limits.maxPages > 0 && (await canReadPages());
    const sources = R.makeSources({ titleChars: GA.config.RESEARCH_SOURCE_TITLE_CHARS });
    const made = GA.researchTools.make({ settings, signal: o.signal, canRead, sources });
    // Without the grant read_page is not offered at all (the prompt says so),
    // rather than offered and failing on every call.
    const tools = { web_search: made.web_search };
    if (canRead) tools.read_page = made.read_page;
    const system = R.buildSystemPrompt({
      limits,
      canSearch: limits.maxSearches > 0,
      canRead,
      today: new Date().toISOString().slice(0, 10),
    });

    const out = await GA.researchLoop.run({
      adapter: provider.adapter(),
      model,
      key,
      system,
      userText: o.prompt,
      tools,
      limits,
      signal: o.signal,
      onText: o.onText,
      onStep: o.onStep,
      sources,
    });
    return {
      text: out.text,
      research: {
        provider: provider.registryId,
        model,
        steps: out.steps,
        searches: out.searches,
        pages: out.pages,
        sources: out.sources,
      },
    };
  }

  return {
    get PROVIDERS() {
      return getProviders();
    },
    run,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.research;
