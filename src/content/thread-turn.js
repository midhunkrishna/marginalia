// thread-turn.js — the presenter for one Q&A turn, lifted out of the view.
// All side effects are injected via `ops`, so the orchestration (append the
// question, persist, stream the reply, handle errors) is simple to follow and
// can be tested with fakes — no DOM required.
//
// ops = {
//   appendUser(text),                 // render the user's message
//   beginModel({ provider }) -> handle, // start an (empty) model message, return a handle
//                                     //   (provider: the override, so the bubble can tag itself)
//   renderModel(handle, text),        // (re)render the model message
//   endModel(handle),                 // optional: finalize the model message
//   renderError(handle, message),     // optional: render a failure (retry card);
//                                     //   falls back to renderModel("⚠️ " + message)
//   setLoading(bool),
//   ask(thread, { onChunk, provider }) -> Promise<string>,
//                                     //   provider: optional override (issue #8)
//   persist(thread),
//   renderStep(handle, step),         // optional: live research progress (MSG_STEP
//                                     //   shape, see shared/protocol.js)
// }
//
// Research turns (opts.research, the composer's Research toggle) run through
// researchAndStream: ops.beginModel({provider, research: true}), then
// ops.ask(thread, {provider, research: true, onChunk, onStep}) resolving
// {text, research}. The final ops.renderModel call gets a third argument,
// {research: {model, sources}}, so the view can linkify [n] citations. Both
// messages are stamped research: true + the research provider's registry id.
//
// opts.provider (from the composer's picker) is stamped on the user message
// AND on the reply it produces, so a mixed thread stays honest — a missing
// stamp always means "the site's own model". Retry re-asks the same provider.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.threadTurn = (function () {
  // opts.md: the composer's markdown toggle — stamped onto the stored message
  // so the choice survives reloads (renderers branch on it).
  async function run(thread, question, ops, opts) {
    const msg = { role: "user", text: question, ts: Date.now() };
    if (opts && opts.md) msg.md = true;
    if (opts && opts.research) {
      const option = researchOption();
      msg.research = true;
      if (option) msg.provider = option.id;
      ops.appendUser(question, msg);
      thread.messages.push(msg);
      await settle(ops.persist, thread);
      return researchAndStream(thread, ops, option ? option.id : null);
    }
    const provider = opts && opts.provider ? opts.provider : null;
    if (provider) msg.provider = provider;
    ops.appendUser(question, msg);
    thread.messages.push(msg);
    await settle(ops.persist, thread);
    return askAndStream(thread, ops, provider);
  }

  // Re-send the thread's last question after a failure: drop the trailing
  // error message and ask again — the question itself is still in
  // thread.messages, so the user never has to retype it.
  async function retry(thread, ops) {
    const last = thread.messages[thread.messages.length - 1];
    if (last && last.error) thread.messages.pop();
    await settle(ops.persist, thread);
    const lastUser = lastUserMessage(thread);
    if (lastUser && lastUser.research) {
      // Re-resolve: the research provider may have been fixed in Options
      // since the failure (that's usually why the user hit Retry).
      const option = researchOption();
      return researchAndStream(thread, ops, option ? option.id : null);
    }
    return askAndStream(thread, ops, (lastUser && lastUser.provider) || null);
  }

  function lastUserMessage(thread) {
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      const m = thread.messages[i];
      if (m && m.role === "user") return m;
    }
    return null;
  }

  function researchOption() {
    const sites = GA.core && GA.core.sites;
    return sites && sites.researchOption ? sites.researchOption(GA.settings) : null;
  }

  const NO_RESEARCH_PROVIDER = "Pick a research provider in Marginalia's options.";

  // Research sources as persisted on the reply: id, title, url only — the
  // background's read/cited flags and any snippets stay out of storage.
  function trimSources(sources) {
    return (sources || []).map((s) => ({ n: s.n, title: s.title || "", url: s.url }));
  }

  // One research turn. provider: the research provider's registry id (null =
  // none configured, rendered as an error card with Retry like any failure).
  async function researchAndStream(thread, ops, provider) {
    ops.setLoading(true);
    const beginMeta = { research: true };
    if (provider) beginMeta.provider = provider;
    const handle = ops.beginModel(beginMeta);
    let acc = "";
    let lastStep = 0; // for "Connection lost after step N"
    const reply = (fields) => {
      const m = Object.assign({ role: "model" }, fields, { ts: Date.now() });
      if (provider) m.provider = provider;
      thread.messages.push(m);
    };
    const fail = (msg) => {
      if (ops.renderError) ops.renderError(handle, msg);
      else ops.renderModel(handle, "⚠️ " + msg);
      reply({ text: msg, error: true });
      acc = msg;
    };
    try {
      if (!provider) throw new Error(NO_RESEARCH_PROVIDER);
      const out = await ops.ask(thread, {
        provider,
        research: true,
        onChunk(t) {
          acc = t;
          ops.renderModel(handle, acc);
        },
        onStep(step) {
          if (step && typeof step.step === "number") lastStep = step.step;
          if (ops.renderStep) ops.renderStep(handle, step);
        },
      });
      const done = out && typeof out === "object" ? out : { text: out, research: null };
      acc = done.text || acc;
      if (done.stopped) {
        ops.renderModel(handle, acc);
        if (acc) reply({ text: acc, stopped: true, research: { model: null, sources: [] } });
      } else {
        const r = done.research || {};
        const research = { model: r.model || null, sources: trimSources(r.sources) };
        ops.renderModel(handle, acc, { research });
        reply({ text: acc, research });
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        if (acc) reply({ text: acc, stopped: true, research: { model: null, sources: [] } });
      } else if (err && err.code === "DISCONNECTED" && lastStep > 0) {
        fail("Connection lost after step " + lastStep + ".");
      } else {
        fail((err && err.message) || "Request failed.");
      }
    } finally {
      if (ops.endModel) ops.endModel(handle);
      ops.setLoading(false);
      await settle(ops.persist, thread);
    }
    return acc;
  }

  async function askAndStream(thread, ops, provider) {
    ops.setLoading(true);
    const handle = ops.beginModel(provider ? { provider } : undefined);
    let acc = "";
    const reply = (fields) => {
      const m = Object.assign({ role: "model" }, fields, { ts: Date.now() });
      if (provider) m.provider = provider;
      thread.messages.push(m);
    };
    try {
      const finalText = await ops.ask(thread, {
        provider: provider || undefined,
        onChunk(t) {
          acc = t;
          ops.renderModel(handle, acc);
        },
      });
      acc = finalText || acc;
      ops.renderModel(handle, acc);
      reply({ text: acc });
    } catch (err) {
      if (err && err.name === "AbortError") {
        // Cancelled (stop button, conversation switch, thread deleted): keep
        // whatever streamed in as a normal message; no error card.
        if (acc) reply({ text: acc, stopped: true });
      } else {
        const msg = (err && err.message) || "Request failed.";
        if (ops.renderError) ops.renderError(handle, msg);
        else ops.renderModel(handle, "⚠️ " + msg);
        reply({ text: msg, error: true });
        acc = msg;
      }
    } finally {
      if (ops.endModel) ops.endModel(handle);
      ops.setLoading(false);
      await settle(ops.persist, thread);
    }
    return acc;
  }

  // Never let a persist failure reject the turn.
  function settle(fn, arg) {
    try {
      return Promise.resolve(fn && fn(arg));
    } catch (e) {
      return Promise.resolve();
    }
  }

  return { run, retry };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.threadTurn;
