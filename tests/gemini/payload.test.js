import { describe, it, expect } from "vitest";
import payload from "../../src/gemini/payload.js";

const { buildBody, buildUrl } = payload;

describe("buildBody", () => {
  it("includes the at token and an f.req field", () => {
    const body = buildBody("why 8kb?", "AT_TOKEN");
    const params = new URLSearchParams(body);
    expect(params.get("at")).toBe("AT_TOKEN");
    expect(params.get("f.req")).toBeTruthy();
  });

  it("round-trips a prompt with quotes, newlines and unicode through f.req", () => {
    const prompt = 'Why "8 KB"?\nLine 2 — café ☕';
    const inner = JSON.parse(
      JSON.parse(new URLSearchParams(buildBody(prompt, "t")).get("f.req"))[1],
    );
    expect(inner[0][0]).toBe(prompt); // prompt preserved exactly
  });

  const triplet = (...args) =>
    JSON.parse(JSON.parse(new URLSearchParams(buildBody(...args)).get("f.req"))[1])[2];

  it("uses an empty conversation triplet without a session (new conversation)", () => {
    expect(triplet("q", "t")).toEqual([null, null, null]);
  });

  it("fills the triplet [c, r, rc] from a valid session", () => {
    expect(triplet("q", "t", { c: "c_1", r: "r_1", rc: "rc_1" })).toEqual(["c_1", "r_1", "rc_1"]);
  });

  it.each([
    ["a missing id", { c: "c_1", r: "r_1" }],
    ["a wrong prefix", { c: "c_1", r: "x_1", rc: "rc_1" }],
    ["a non-string id", { c: "c_1", r: "r_1", rc: 5 }],
    ["a bare prefix", { c: "c_", r: "r_1", rc: "rc_1" }],
    ["a non-object", "c_1"],
  ])("falls back to the empty triplet for %s", (_n, session) => {
    expect(triplet("q", "t", session)).toEqual([null, null, null]);
  });

  it("keeps the full prompt when continuing a session", () => {
    const body = buildBody("full ctx", "t", { c: "c_1", r: "r_1", rc: "rc_1" });
    const inner = JSON.parse(JSON.parse(new URLSearchParams(body).get("f.req"))[1]);
    expect(inner[0][0]).toBe("full ctx");
  });
});

describe("buildUrl", () => {
  it("carries bl, f.sid, hl, rt=c and a _reqid", () => {
    const u = new URL(buildUrl("boq_x", "12345"));
    expect(u.searchParams.get("bl")).toBe("boq_x");
    expect(u.searchParams.get("f.sid")).toBe("12345");
    expect(u.searchParams.get("hl")).toBe("en");
    expect(u.searchParams.get("rt")).toBe("c");
    expect(u.searchParams.get("_reqid")).toBeTruthy();
  });

  it("omits bl / f.sid when not provided", () => {
    const u = new URL(buildUrl(null, null));
    expect(u.searchParams.has("bl")).toBe(false);
    expect(u.searchParams.has("f.sid")).toBe(false);
  });

  it("increments _reqid on each call", () => {
    const a = Number(new URL(buildUrl("b", "s")).searchParams.get("_reqid"));
    const b = Number(new URL(buildUrl("b", "s")).searchParams.get("_reqid"));
    expect(b).toBeGreaterThan(a);
  });
});
