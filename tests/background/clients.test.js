import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// clientFor() resolves GA[name] lazily, so we can stub the client objects on the
// shared GA after loading the registry + dispatch.
function dispatch() {
  const GA = loadGA(["src/background/registry.js", "src/background/clients.js"]);
  GA.geminiWebClient = { id: "gemini-web" };
  GA.googleaiClient = { id: "googleai-api" };
  GA.openaiClient = { id: "openai-api" };
  GA.claudeClient = { id: "claude-web" };
  GA.anthropicClient = { id: "anthropic-api" };
  GA.openrouterClient = { id: "openrouter-api" };
  return GA;
}

describe("clientFor (registry dispatch)", () => {
  it("uses the official API client when that provider's key is set", () => {
    const GA = dispatch();
    expect(GA.clientFor("gemini", { geminiApiKey: "k" })).toBe(GA.googleaiClient);
    expect(GA.clientFor("claude", { anthropicApiKey: "k" })).toBe(GA.anthropicClient);
    expect(GA.clientFor("chatgpt", { openaiApiKey: "k" })).toBe(GA.openaiClient);
  });

  it("falls back to the web-session client when no key is set", () => {
    const GA = dispatch();
    expect(GA.clientFor("gemini", {})).toBe(GA.geminiWebClient);
    expect(GA.clientFor("claude", {})).toBe(GA.claudeClient);
  });

  it("routes ChatGPT to the OpenAI client even without a key (no web fallback)", () => {
    const GA = dispatch();
    expect(GA.clientFor("chatgpt", {})).toBe(GA.openaiClient);
  });

  it("routes OpenRouter to its API client, with or without a key (API only)", () => {
    const GA = dispatch();
    expect(GA.clientFor("openrouter", { openrouterApiKey: "k" })).toBe(GA.openrouterClient);
    expect(GA.clientFor("openrouter", {})).toBe(GA.openrouterClient);
  });

  it("treats an empty-string key as unset", () => {
    const GA = dispatch();
    expect(GA.clientFor("gemini", { geminiApiKey: "" })).toBe(GA.geminiWebClient);
  });

  it("throws for an unknown provider (background surfaces it via MSG_ERROR)", () => {
    const GA = dispatch();
    expect(() => GA.clientFor("mystery", {})).toThrow("Unknown provider: mystery");
    expect(() => GA.clientFor(undefined, {})).toThrow("Unknown provider: undefined");
  });

  it("tolerates missing settings", () => {
    const GA = dispatch();
    expect(GA.clientFor("gemini")).toBe(GA.geminiWebClient);
  });
});
