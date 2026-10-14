// research-loop.js — the provider-neutral Research Mode tool loop. Each step is
// one streamed model turn through a provider adapter (src/<provider>/tools.js);
// tool calls run sequentially through research-tools.js and their results go
// back into the conversation until the model answers, the step budget runs out
// or the run deadline passes (both force a tools-off final turn). Everything is
// injected (adapter, tools, fetch, clock), so the loop is tested without I/O.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.researchLoop = (function () {
  const FINAL_NUDGE =
    "You have no research steps left. Answer now from what you already found, citing [n] ids you were given.";

  function normQuery(q) {
    return String(q == null ? "" : q)
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  async function run(opts) {
    const o = opts || {};
    const adapter = o.adapter;
    const tools = o.tools || {};
    const limits = o.limits || GA.core.research.LIMIT_DEFAULTS;
    const signal = o.signal;
    const onText = o.onText || function () {};
    const onStep = o.onStep || function () {};
    const doFetch = o.fetchImpl || fetch;
    const now = o.now || Date.now;
    const R = GA.core.research;

    const toolDefs = R.TOOL_DEFS.filter(function (d) {
      if (d.name === "web_search") return limits.maxSearches > 0 && !!tools.web_search;
      if (d.name === "read_page") return limits.maxPages > 0 && !!tools.read_page;
      return false;
    });

    // One serialisable-ish object so a later resume feature can checkpoint it.
    const state = {
      step: 0,
      searches: 0,
      pages: 0,
      convo: adapter.initConvo(o.userText),
      sources: o.sources || R.makeSources({ titleChars: GA.config.RESEARCH_SOURCE_TITLE_CHARS }),
      queryCache: {},
    };
    const sources = state.sources;
    const deadline = now() + GA.config.RESEARCH_RUN_TIMEOUT_MS;

    function checkAbort() {
      if (signal && signal.aborted) throw GA.abortError();
    }

    // One model turn: stream text to the user until the first tool call shows
    // up, then take the preamble back (reset) and keep it as a note step.
    async function modelTurn(forceFinal) {
      const req = adapter.buildRequest(o.model, o.key, state.convo, toolDefs, {
        system: o.system,
        toolChoice: forceFinal ? "none" : "auto",
      });
      const budget = GA.makeAbortBudget(GA.REQUEST_TIMEOUT_MS, signal);
      const cursor = adapter.makeCursor();
      let shown = "";
      let retracted = false;
      const stream = GA.sse.makeEventStream(function (ev) {
        const r = cursor.push(ev);
        if (!retracted && cursor.hasToolCalls()) {
          retracted = true;
          if (shown) {
            onText("");
            onStep({ kind: "note", step: state.step, text: shown });
          }
        }
        return r;
      });
      try {
        const res = await doFetch(req.url, {
          method: "POST",
          headers: req.headers,
          body: req.body,
          signal: budget.signal,
        });
        if (!res.ok) throw new Error(await GA.apiError(adapter.label, res));
        await GA.pumpStream(
          res,
          stream,
          function (t) {
            if (cursor.hasToolCalls()) return;
            shown = t;
            onText(t);
          },
          budget,
        );
      } catch (e) {
        throw GA.mapBudgetError(e, budget, adapter.label + " request timed out.");
      } finally {
        budget.clear();
      }
      return cursor.end(); // throws on a provider error event
    }

    async function doSearch(call) {
      const query = String((call.args && call.args.query) || "").trim();
      const key = normQuery(query);
      const cached = key && state.queryCache[key];
      if (!cached && state.searches >= limits.maxSearches)
        throw new Error("Search budget exhausted; answer from what you have.");
      onStep({ kind: "search", step: state.step, query });
      let out = cached;
      if (!out) {
        out = await tools.web_search({ query });
        state.searches++;
        if (key) state.queryCache[key] = out;
      }
      const hits = out.sources || [];
      onStep({ kind: "results", step: state.step, query, count: hits.length, sources: hits });
      return out.content;
    }

    async function doRead(call) {
      const url = String((call.args && call.args.url) || "").trim();
      if (state.pages >= limits.maxPages)
        throw new Error("Page budget exhausted; answer from what you have.");
      onStep({ kind: "read", step: state.step, url });
      const out = await tools.read_page({ url });
      state.pages++;
      onStep({
        kind: "read-done",
        step: state.step,
        n: out.n,
        title: out.title,
        chars: out.chars,
      });
      return out.content;
    }

    // Never throws except on abort: every failure becomes a tool error the
    // model sees, and the run goes on.
    async function execute(call) {
      const base = { id: call.id, name: call.name };
      try {
        checkAbort();
        const offered = toolDefs.some((d) => d.name === call.name);
        if (!offered) throw new Error("Unknown tool: " + call.name);
        if (call.args == null) throw new Error("arguments were not valid JSON");
        const content = call.name === "web_search" ? await doSearch(call) : await doRead(call);
        return Object.assign(base, { content: String(content), isError: false });
      } catch (e) {
        // A user stop ends the run; it is never a tool error.
        if (signal && signal.aborted) throw GA.abortError();
        if (e && e.name === "AbortError") throw e;
        const message = (e && e.message) || String(e);
        onStep({ kind: "tool-error", step: state.step, tool: call.name, message });
        return Object.assign(base, { content: message, isError: true });
      }
    }

    let finalText;
    for (;;) {
      checkAbort();
      state.step++;
      const forceFinal = state.step >= limits.maxSteps || now() > deadline;
      if (forceFinal) adapter.appendUser(state.convo, FINAL_NUDGE);
      onStep({ kind: "step", step: state.step, maxSteps: limits.maxSteps });
      const turn = await modelTurn(forceFinal);
      if (!turn.toolCalls || !turn.toolCalls.length || forceFinal) {
        finalText = turn.text || "";
        onStep({ kind: "final", step: state.step });
        break;
      }
      adapter.appendAssistant(state.convo, turn);
      const results = [];
      for (const call of turn.toolCalls) results.push(await execute(call));
      adapter.appendToolResults(state.convo, results);
      if (o.onCheckpoint) o.onCheckpoint(state);
    }

    if (!finalText.trim()) throw new Error(adapter.label + " returned an empty answer.");
    const text = R.appendSourcesMarkdown(finalText, sources);
    onText(text);
    const cited = R.citedIds(finalText);
    return {
      text,
      sources: sources.list().map((s) => Object.assign(s, { cited: cited.indexOf(s.n) >= 0 })),
      steps: state.step,
      searches: state.searches,
      pages: state.pages,
    };
  }

  return { run, FINAL_NUDGE };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.researchLoop;
