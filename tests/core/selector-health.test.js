import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const health = require("../../src/core/selector-health.js");

const T = 10000;
const base = { sessionId: "gemini:abc", threshold: T };
const healthy = { turnCounts: { user: 3, model: 3 }, responseCounts: 3 };

describe("selector-health.evaluate", () => {
  it("is ok when every tier matches, however early", () => {
    expect(health.evaluate({ ...base, ...healthy, elapsedMs: 0 })).toEqual({
      status: "ok",
      tier: null,
    });
  });

  it("is ok on a new chat (no session id) even with zero matches after the threshold", () => {
    const r = health.evaluate({
      sessionId: null,
      turnCounts: { user: 0, model: 0 },
      responseCounts: 0,
      elapsedMs: 60000,
      threshold: T,
    });
    expect(r.status).toBe("ok");
  });

  it("stays pending while a tier is empty but the threshold has not elapsed", () => {
    const r = health.evaluate({
      ...base,
      turnCounts: { user: 2, model: 0 },
      responseCounts: 0,
      elapsedMs: T - 1,
    });
    expect(r).toEqual({ status: "pending", tier: "model" });
  });

  it("flags the model tier once the threshold elapses with questions but no answers", () => {
    const r = health.evaluate({
      ...base,
      turnCounts: { user: 2, model: 0 },
      responseCounts: 2,
      elapsedMs: T,
    });
    expect(r).toEqual({ status: "broken", tier: "model" });
  });

  it("flags the user tier when answers match but questions do not", () => {
    const r = health.evaluate({
      ...base,
      turnCounts: { user: 0, model: 2 },
      responseCounts: 2,
      elapsedMs: T,
    });
    expect(r).toEqual({ status: "broken", tier: "user" });
  });

  it("flags the response tier when turns match but responseSelectors do not", () => {
    const r = health.evaluate({
      ...base,
      turnCounts: { user: 2, model: 2 },
      responseCounts: 0,
      elapsedMs: T,
    });
    expect(r).toEqual({ status: "broken", tier: "response" });
  });

  it("flags every tier at once as 'all' when nothing matches", () => {
    const r = health.evaluate({
      ...base,
      turnCounts: { user: 0, model: 0 },
      responseCounts: 0,
      elapsedMs: T,
    });
    expect(r).toEqual({ status: "broken", tier: "all" });
  });

  it("tolerates missing counts as zero", () => {
    const r = health.evaluate({ sessionId: "x", elapsedMs: T, threshold: T });
    expect(r).toEqual({ status: "broken", tier: "all" });
  });
});

describe("selector-health.reportUrl", () => {
  it("prefills a new-issue URL with site, tier and version", () => {
    const url = new URL(health.reportUrl({ provider: "chatgpt", tier: "model", version: "0.4.1" }));
    expect(url.origin + url.pathname).toBe(
      "https://github.com/midhunkrishna/marginalia/issues/new",
    );
    expect(url.searchParams.get("title")).toMatch(/chatgpt/);
    const body = url.searchParams.get("body");
    expect(body).toMatch(/chatgpt/);
    expect(body).toMatch(/model/);
    expect(body).toMatch(/0\.4\.1/);
  });

  it("falls back to 'unknown' when the version is unavailable", () => {
    const url = new URL(health.reportUrl({ provider: "claude", tier: "user" }));
    expect(url.searchParams.get("body")).toMatch(/unknown/);
  });
});
