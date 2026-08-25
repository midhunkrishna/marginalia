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
// }
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
    return askAndStream(thread, ops, lastUserProvider(thread));
  }

  function lastUserProvider(thread) {
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      const m = thread.messages[i];
      if (m && m.role === "user") return m.provider || null;
    }
    return null;
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
