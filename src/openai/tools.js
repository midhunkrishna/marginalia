// tools.js — research-mode tool-calling adapter for OpenAI Chat Completions
// (the contract is in background/research-loop.js). Pure: builds requests,
// reshapes the conversation, and folds parsed SSE events into one turn.
// `make({label, endpoint, headers})` serves any compatible endpoint
// (openrouter/tools.js); endpoint may be a string or a lazy () -> string.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.openai = GA.openai || {};

GA.openai.tools = (function () {
  // "" -> {} (a no-argument call); anything but a JSON object -> null, which
  // the loop reports back to the model as a tool error.
  function parseArgs(s) {
    if (!s) return {};
    try {
      const v = JSON.parse(s);
      return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function make(config) {
    function endpoint() {
      return typeof config.endpoint === "function" ? config.endpoint() : config.endpoint;
    }

    function buildRequest(model, key, convo, toolDefs, opts) {
      const o = opts || {};
      const body = {
        model: model,
        stream: true,
        messages: [{ role: "system", content: o.system || "" }].concat(convo),
      };
      // tool_choice without tools is a 400, so both go or neither does.
      if (toolDefs && toolDefs.length) {
        body.tools = toolDefs.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
        body.tool_choice = o.toolChoice === "none" ? "none" : "auto";
      }
      return { url: endpoint(), headers: config.headers(key), body: JSON.stringify(body) };
    }

    function initConvo(userText) {
      return [{ role: "user", content: userText || "" }];
    }

    function appendUser(convo, text) {
      convo.push({ role: "user", content: text });
      return convo;
    }

    function appendAssistant(convo, turn) {
      const msg = { role: "assistant", content: turn.text || null };
      const calls = turn.toolCalls || [];
      if (calls.length) {
        msg.tool_calls = calls.map(
          (c) =>
            c.raw || {
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
            },
        );
      }
      convo.push(msg);
      return convo;
    }

    function appendToolResults(convo, results) {
      for (const r of results) {
        convo.push({
          role: "tool",
          tool_call_id: r.id,
          content: r.isError ? "ERROR: " + r.content : r.content,
        });
      }
      return convo;
    }

    // Tool calls stream as fragments keyed by `index`: id and name on the
    // first, `function.arguments` split across the rest.
    function makeCursor() {
      let text = "";
      let stop = null;
      let error = null;
      const calls = []; // by index

      return {
        push(obj) {
          if (!obj || typeof obj !== "object") return null;
          if (obj.error) {
            error = (obj.error && obj.error.message) || config.label + " stream error.";
            return null;
          }
          const choice = obj.choices && obj.choices[0];
          if (!choice) return null;
          if (choice.finish_reason) stop = choice.finish_reason;
          const delta = choice.delta || {};
          for (const tc of delta.tool_calls || []) {
            const i = typeof tc.index === "number" ? tc.index : calls.length;
            const c = calls[i] || (calls[i] = { id: "", name: "", arguments: "" });
            if (tc.id) c.id = tc.id;
            const fn = tc.function || {};
            if (fn.name) c.name += fn.name;
            if (typeof fn.arguments === "string") c.arguments += fn.arguments;
          }
          if (typeof delta.content === "string" && delta.content) {
            text += delta.content;
            return text;
          }
          return null;
        },
        hasToolCalls() {
          return calls.length > 0;
        },
        end() {
          if (error) throw new Error(error);
          const toolCalls = calls
            .filter((c) => c)
            .map((c) => ({
              id: c.id,
              name: c.name,
              args: parseArgs(c.arguments),
              raw: {
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: c.arguments },
              },
            }));
          return { text, toolCalls, stop };
        },
      };
    }

    return {
      label: config.label,
      buildRequest,
      initConvo,
      appendUser,
      appendAssistant,
      appendToolResults,
      makeCursor,
      make,
    };
  }

  // Lazy lookups: openai/payload.js need not load before this file.
  return make({
    label: "OpenAI",
    endpoint: () => GA.openai.payload.ENDPOINT,
    headers: (key) => GA.openai.payload.headers(key),
  });
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.openai.tools;
