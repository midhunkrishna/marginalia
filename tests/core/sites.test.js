import { describe, it, expect } from "vitest";
import sites from "../../src/core/sites.js";

const { providerForHost, sessionIdFromPath, responseSelectors, conversationUrl } = sites;

describe("providerForHost", () => {
  it("maps each site's host(s) to a provider id", () => {
    expect(providerForHost("gemini.google.com")).toBe("gemini");
    expect(providerForHost("chatgpt.com")).toBe("chatgpt");
    expect(providerForHost("chat.openai.com")).toBe("chatgpt");
    expect(providerForHost("claude.ai")).toBe("claude");
  });

  it("matches subdomains and is case-insensitive", () => {
    expect(providerForHost("www.claude.ai")).toBe("claude");
    expect(providerForHost("Gemini.Google.Com")).toBe("gemini");
  });

  it("returns null off-site and for empty input", () => {
    expect(providerForHost("example.com")).toBeNull();
    expect(providerForHost("notgemini.google.com.evil.com")).toBeNull();
    expect(providerForHost("")).toBeNull();
    expect(providerForHost(null)).toBeNull();
  });
});

describe("sessionIdFromPath", () => {
  it("extracts the Gemini id from /app/<id> (incl. /u/0/app)", () => {
    expect(sessionIdFromPath("gemini", "/app/4256384b373874")).toBe("4256384b373874");
    expect(sessionIdFromPath("gemini", "/u/0/app/xyz789")).toBe("xyz789");
  });

  it("extracts the ChatGPT id from /c/<id>", () => {
    expect(sessionIdFromPath("chatgpt", "/c/abc-123")).toBe("abc-123");
  });

  it("extracts the Claude id from /chat/<id>", () => {
    expect(sessionIdFromPath("claude", "/chat/uuid-9")).toBe("uuid-9");
  });

  it("extracts a Gemini Gem chat from /gem/<gemId>/<chatId>, but not the Gem lobby", () => {
    expect(sessionIdFromPath("gemini", "/gem/coding-partner/77cd11a2")).toBe(
      "coding-partner/77cd11a2",
    );
    expect(sessionIdFromPath("gemini", "/u/0/gem/coding-partner/77cd11a2")).toBe(
      "coding-partner/77cd11a2",
    );
    expect(sessionIdFromPath("gemini", "/gem/coding-partner")).toBeNull(); // lobby = new chat
    expect(sessionIdFromPath("gemini", "/gem/coding-partner/77cd11a2?x=1#y")).toBe(
      "coding-partner/77cd11a2",
    );
  });

  it("extracts project-scoped chats on Claude and ChatGPT", () => {
    expect(sessionIdFromPath("claude", "/project/p-1/chat/uuid-9")).toBe("uuid-9");
    expect(sessionIdFromPath("claude", "/project/p-1")).toBeNull(); // project lobby
    expect(sessionIdFromPath("chatgpt", "/g/g-custom/c/abc-123")).toBe("abc-123");
  });

  it("ignores query/hash and percent-decodes", () => {
    expect(sessionIdFromPath("gemini", "/app/abc?foo=1#x")).toBe("abc");
    expect(sessionIdFromPath("chatgpt", "/c/a%20b")).toBe("a b");
  });

  it("returns null when no chat is open or provider is unknown", () => {
    expect(sessionIdFromPath("gemini", "/app")).toBeNull();
    expect(sessionIdFromPath("chatgpt", "/")).toBeNull();
    expect(sessionIdFromPath("claude", "/new")).toBeNull();
    expect(sessionIdFromPath("nope", "/chat/x")).toBeNull();
    expect(sessionIdFromPath("gemini", null)).toBeNull();
  });
});

describe("responseSelectors", () => {
  it("returns a non-empty selector list per provider", () => {
    expect(responseSelectors("gemini").length).toBeGreaterThan(0);
    expect(responseSelectors("chatgpt")).toContain('[data-message-author-role="assistant"]');
    expect(responseSelectors("claude")).toContain(".font-claude-response");
  });

  it("returns a copy (callers can't mutate the registry)", () => {
    const a = responseSelectors("gemini");
    a.push("x");
    expect(responseSelectors("gemini")).not.toContain("x");
  });

  it("returns [] for an unknown provider", () => {
    expect(responseSelectors("nope")).toEqual([]);
  });
});

describe("conversationUrl", () => {
  it("builds each site's canonical chat route from an id", () => {
    expect(conversationUrl("gemini", "4256384b373874")).toBe(
      "https://gemini.google.com/app/4256384b373874",
    );
    expect(conversationUrl("chatgpt", "abc-123")).toBe("https://chatgpt.com/c/abc-123");
    expect(conversationUrl("claude", "u-u-i-d")).toBe("https://claude.ai/chat/u-u-i-d");
  });

  it("routes a Gem conversation id (gemId/chatId) under /gem/", () => {
    expect(conversationUrl("gemini", "g1/c2")).toBe("https://gemini.google.com/gem/g1/c2");
  });

  it("round-trips with sessionIdFromPath", () => {
    for (const [p, id] of [
      ["gemini", "xyz789"],
      ["gemini", "g1/c2"],
      ["chatgpt", "abc"],
      ["claude", "def"],
    ]) {
      expect(sessionIdFromPath(p, new URL(conversationUrl(p, id)).pathname)).toBe(id);
    }
  });

  it("returns null for unknown providers or empty ids", () => {
    expect(conversationUrl("bing", "x")).toBeNull();
    expect(conversationUrl("gemini", "")).toBeNull();
    expect(conversationUrl("gemini", null)).toBeNull();
  });
});

// ---- issue #8: provider picker helpers ---------------------------------
import registry from "../../src/background/registry.js";

const { askOptions, viaLabel, PROVIDERS } = sites;

describe("askOptions", () => {
  it("lists only the site's own provider when no keys are set (picker hidden)", () => {
    expect(askOptions("claude", {})).toEqual([
      { id: "claude", label: "Claude", site: true, model: null },
    ]);
  });

  it("site first, then every OTHER keyed provider with its configured model", () => {
    const out = askOptions("claude", {
      geminiApiKey: "g",
      geminiModel: "gemini-2.5-flash",
      openaiApiKey: "o",
      openaiModel: "gpt-4o-mini",
    });
    expect(out.map((p) => p.id)).toEqual(["claude", "gemini", "chatgpt"]);
    expect(out[0]).toEqual({ id: "claude", label: "Claude", site: true, model: null });
    expect(out[1]).toEqual({
      id: "gemini",
      label: "Gemini",
      site: false,
      model: "gemini-2.5-flash",
    });
    expect(out[2].model).toBe("gpt-4o-mini");
  });

  it("the site's own entry reports its model only once a key routes it to the API", () => {
    const out = askOptions("gemini", { geminiApiKey: "g", geminiModel: "m" });
    expect(out).toEqual([{ id: "gemini", label: "Gemini", site: true, model: "m" }]);
  });

  it("an unknown site yields just the keyed providers; settings may be absent", () => {
    expect(askOptions(null, undefined)).toEqual([]);
    expect(askOptions("nope", { anthropicApiKey: "a" }).map((p) => p.id)).toEqual(["claude"]);
  });
});

describe("viaLabel", () => {
  it("names a provider other than the site's own, null otherwise", () => {
    expect(viaLabel("gemini", "claude")).toBe("Gemini");
    expect(viaLabel("claude", "claude")).toBeNull();
    expect(viaLabel(undefined, "claude")).toBeNull();
    expect(viaLabel("mystery", "claude")).toBe("mystery");
  });
});

describe("key fields agree with the background registry", () => {
  it("every provider's keyField matches background/registry.js apiKeyField", () => {
    for (const id in registry.PROVIDERS) {
      expect(PROVIDERS[id].keyField).toBe(registry.PROVIDERS[id].apiKeyField);
    }
    expect(Object.keys(PROVIDERS).sort()).toEqual(Object.keys(registry.PROVIDERS).sort());
  });
});
