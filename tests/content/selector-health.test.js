import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// B6 selector-health: one toast per session per site when a conversation
// exists but zero answer containers match, plus a debug warning naming the
// failed selector tier.

const FILES = ["src/content/selector-health.js"];
const location = { hostname: "gemini.google.com", pathname: "/app/abc" };

function makeHealth() {
  const GA = loadGA(FILES, { location });
  GA.toast = vi.fn();
  GA.warn = vi.fn();
  GA.core = GA.core || {};
  return GA;
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("GA.selectorHealth", () => {
  it("fires once per session when turns are empty but a conversation exists", () => {
    const GA = makeHealth();
    GA.provider = "gemini";
    GA.core.sites = {
      turnSelector: () => "model-response",
      sessionIdFromPath: () => "abc",
    };
    GA.turns = { findTurns: () => [] };

    GA.selectorHealth.check();
    GA.selectorHealth.check();
    expect(GA.toast).toHaveBeenCalledTimes(1);
    expect(GA.warn).toHaveBeenCalledTimes(1);
  });

  it("stays silent when there is no conversation id", () => {
    const GA = makeHealth();
    GA.provider = "gemini";
    GA.core.sites = {
      turnSelector: () => "model-response",
      sessionIdFromPath: () => null,
    };
    GA.turns = { findTurns: () => [] };

    GA.selectorHealth.check();
    expect(GA.toast).not.toHaveBeenCalled();
    expect(GA.warn).not.toHaveBeenCalled();
  });

  it("stays silent when turns are found", () => {
    const GA = makeHealth();
    GA.provider = "gemini";
    GA.core.sites = {
      turnSelector: () => "model-response",
      sessionIdFromPath: () => "abc",
    };
    GA.turns = { findTurns: () => [{ el: { contains: () => false }, role: "model" }] };

    GA.selectorHealth.check();
    expect(GA.toast).not.toHaveBeenCalled();
    expect(GA.warn).not.toHaveBeenCalled();
  });
});
