import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// OpenRouter reuses the OpenAI adapter via make(); only url, headers and label differ.
const GA = loadGA([
  "src/openai/payload.js",
  "src/openrouter/payload.js",
  "src/openai/tools.js",
  "src/openrouter/tools.js",
]);
const tools = GA.openrouter.tools;
const DEFS = [{ name: "web_search", description: "Search", parameters: { type: "object" } }];

describe("openrouter tools", () => {
  it("targets OpenRouter with its headers and the OpenAI body shape", () => {
    const req = tools.buildRequest("x/y", "or-k", tools.initConvo("q"), DEFS, {
      system: "S",
      toolChoice: "none",
    });
    expect(tools.label).toBe("OpenRouter");
    expect(req.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(req.headers).toMatchObject({ Authorization: "Bearer or-k", "X-Title": "Marginalia" });
    const body = JSON.parse(req.body);
    expect(body.tool_choice).toBe("none");
    expect(body.tools[0].function.name).toBe("web_search");
    expect(body.messages[0]).toEqual({ role: "system", content: "S" });
  });

  it("cursor behaves like the OpenAI one", () => {
    const c = tools.makeCursor();
    c.push({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "t", function: { name: "web_search", arguments: '{"query":"a"}' } },
            ],
          },
        },
      ],
    });
    c.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    expect(c.hasToolCalls()).toBe(true);
    expect(c.end().toolCalls[0]).toMatchObject({
      id: "t",
      name: "web_search",
      args: { query: "a" },
    });
  });

  it("does not disturb the OpenAI adapter", () => {
    const req = GA.openai.tools.buildRequest("m", "k", [], [], {});
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(req.headers).not.toHaveProperty("X-Title");
  });
});
