// tools.js — research-mode tool-calling adapter for the Anthropic Messages API
// (the contract is in background/research-loop.js). Pure: builds requests,
// reshapes the conversation, and folds parsed SSE events into one turn.
// Endpoint and headers come from anthropic/payload.js, looked up lazily.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.anthropic = GA.anthropic || {};

GA.anthropic.tools = (function () {
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

  function buildRequest(model, key, convo, toolDefs, opts) {
    const o = opts || {};
    // Reuse the ask path's url + headers (key, version, direct-browser-access).
    const base = GA.anthropic.payload.buildRequest(model, "", key);
    const body = {
      model: model,
      max_tokens: 4096,
      stream: true,
      system: o.system || "",
      messages: convo,
    };
    if (toolDefs && toolDefs.length) {
      body.tools = toolDefs.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
      body.tool_choice = { type: o.toolChoice === "none" ? "none" : "auto" };
    }
    return { url: base.url, headers: base.headers, body: JSON.stringify(body) };
  }

  function initConvo(userText) {
    return [{ role: "user", content: userText || "" }];
  }

  // Folds into a trailing user message (the tool_result turn) so roles keep
  // alternating.
  function appendUser(convo, text) {
    const last = convo[convo.length - 1];
    if (last && last.role === "user") {
      if (typeof last.content === "string") {
        last.content = [{ type: "text", text: last.content }];
      }
      last.content.push({ type: "text", text: text });
    } else {
      convo.push({ role: "user", content: text });
    }
    return convo;
  }

  function appendAssistant(convo, turn) {
    const content = [];
    if (turn.text) content.push({ type: "text", text: turn.text });
    for (const c of turn.toolCalls || []) {
      content.push({ type: "tool_use", id: c.id, name: c.name, input: c.args || {} });
    }
    convo.push({ role: "assistant", content });
    return convo;
  }

  // All results of one turn go back in ONE user message, in call order.
  function appendToolResults(convo, results) {
    convo.push({
      role: "user",
      content: results.map((r) => {
        const block = { type: "tool_result", tool_use_id: r.id, content: r.content };
        if (r.isError) block.is_error = true;
        return block;
      }),
    });
    return convo;
  }

  // Blocks are addressed by `index`: content_block_start opens a text or
  // tool_use block, deltas append text / partial_json, message_delta carries
  // the stop_reason. An `error` event (e.g. overloaded) fails the turn in end().
  function makeCursor() {
    let text = "";
    let stop = null;
    let error = null;
    const blocks = []; // by index: {type, id, name, json}

    return {
      push(obj) {
        if (!obj || typeof obj !== "object") return null;
        if (obj.type === "error") {
          error = (obj.error && obj.error.message) || "Anthropic stream error.";
          return null;
        }
        if (obj.type === "content_block_start") {
          const cb = obj.content_block || {};
          if (cb.type === "tool_use") {
            blocks[obj.index] = { type: "tool_use", id: cb.id, name: cb.name, json: "" };
          } else if (cb.type === "text") {
            blocks[obj.index] = { type: "text" };
            if (cb.text) {
              text += cb.text;
              return text;
            }
          }
          return null;
        }
        if (obj.type === "content_block_delta") {
          const d = obj.delta || {};
          if (d.type === "text_delta" && typeof d.text === "string" && d.text) {
            text += d.text;
            return text;
          }
          if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
            const b = blocks[obj.index];
            if (b && b.type === "tool_use") b.json += d.partial_json;
          }
          return null;
        }
        if (obj.type === "message_delta" && obj.delta && obj.delta.stop_reason) {
          stop = obj.delta.stop_reason;
        }
        return null;
      },
      hasToolCalls() {
        return blocks.some((b) => b && b.type === "tool_use");
      },
      end() {
        if (error) throw new Error(error);
        const toolCalls = blocks
          .filter((b) => b && b.type === "tool_use")
          .map((b) => ({ id: b.id, name: b.name, args: parseArgs(b.json) }));
        return { text, toolCalls, stop };
      },
    };
  }

  return {
    label: "Anthropic",
    buildRequest,
    initConvo,
    appendUser,
    appendAssistant,
    appendToolResults,
    makeCursor,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.anthropic.tools;
