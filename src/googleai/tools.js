// tools.js — research-mode tool-calling adapter for the Google Generative
// Language API (the contract is in background/research-loop.js). Pure: builds
// requests, reshapes the conversation, and folds parsed SSE events into one
// turn. Url and headers (key in x-goog-api-key) come from googleai/payload.js,
// looked up lazily.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.googleai = GA.googleai || {};

GA.googleai.tools = (function () {
  function buildRequest(model, key, convo, toolDefs, opts) {
    const o = opts || {};
    const base = GA.googleai.payload.buildRequest(model, "", key);
    const body = {
      systemInstruction: { parts: [{ text: o.system || "" }] },
      contents: convo,
    };
    if (toolDefs && toolDefs.length) {
      body.tools = [
        {
          functionDeclarations: toolDefs.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
      body.toolConfig = {
        functionCallingConfig: { mode: o.toolChoice === "none" ? "NONE" : "AUTO" },
      };
    }
    return { url: base.url, headers: base.headers, body: JSON.stringify(body) };
  }

  function initConvo(userText) {
    return [{ role: "user", parts: [{ text: userText || "" }] }];
  }

  // Folds into a trailing user turn (the functionResponse turn) so roles keep
  // alternating.
  function appendUser(convo, text) {
    const last = convo[convo.length - 1];
    if (last && last.role === "user") last.parts.push({ text: text });
    else convo.push({ role: "user", parts: [{ text: text }] });
    return convo;
  }

  // functionCall parts go back verbatim: thinking models attach a
  // thoughtSignature that must be echoed or the next turn is rejected.
  function appendAssistant(convo, turn) {
    const parts = [];
    if (turn.text) parts.push({ text: turn.text });
    for (const c of turn.toolCalls || []) {
      parts.push(c.raw || { functionCall: { name: c.name, args: c.args || {} } });
    }
    convo.push({ role: "model", parts });
    return convo;
  }

  function appendToolResults(convo, results) {
    convo.push({
      role: "user",
      parts: results.map((r) => ({
        functionResponse: {
          name: r.name,
          response: r.isError ? { error: r.content } : { result: r.content },
        },
      })),
    });
    return convo;
  }

  // Each event carries NEW parts: text fragments and whole functionCall parts.
  // Calls get minted ids (`name#index`) since the API sends none.
  // MALFORMED_FUNCTION_CALL means the model botched a call: keep the text,
  // drop the calls, and let the loop finish on it.
  function makeCursor() {
    let text = "";
    let stop = null;
    let error = null;
    const calls = []; // raw functionCall parts

    return {
      push(obj) {
        if (!obj || typeof obj !== "object") return null;
        if (obj.error) {
          error = obj.error.message || "Google AI stream error.";
          return null;
        }
        const cand = obj.candidates && obj.candidates[0];
        if (!cand) return null;
        if (cand.finishReason) stop = cand.finishReason;
        const parts = (cand.content && cand.content.parts) || [];
        let changed = false;
        for (const p of parts) {
          if (!p) continue;
          if (p.functionCall) calls.push(p);
          else if (typeof p.text === "string" && p.text && !p.thought) {
            text += p.text;
            changed = true;
          }
        }
        return changed ? text : null;
      },
      hasToolCalls() {
        return calls.length > 0;
      },
      end() {
        if (error) throw new Error(error);
        const toolCalls =
          stop === "MALFORMED_FUNCTION_CALL"
            ? []
            : calls.map((p, i) => {
                const args = p.functionCall.args;
                return {
                  id: p.functionCall.name + "#" + i,
                  name: p.functionCall.name,
                  args:
                    args == null
                      ? {}
                      : typeof args === "object" && !Array.isArray(args)
                        ? args
                        : null,
                  raw: p,
                };
              });
        return { text, toolCalls, stop };
      },
    };
  }

  return {
    label: "Google AI",
    buildRequest,
    initConvo,
    appendUser,
    appendAssistant,
    appendToolResults,
    makeCursor,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.googleai.tools;
