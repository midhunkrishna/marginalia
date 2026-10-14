import { describe, it, expect } from "vitest";
import threadTurn from "../../src/content/thread-turn.js";
import { loadGA } from "../helpers/loadGA.js";

// A recording fake of the side-effect `ops` the presenter drives.
function makeOps(askImpl) {
  const calls = [];
  const ops = {
    appendUser: (t) => calls.push(["appendUser", t]),
    beginModel: () => {
      calls.push(["beginModel"]);
      return { rendered: [] };
    },
    renderModel: (h, t) => {
      calls.push(["renderModel", t]);
      h.rendered.push(t);
    },
    endModel: () => calls.push(["endModel"]),
    setLoading: (v) => calls.push(["setLoading", v]),
    persist: () => calls.push(["persist"]),
    ask: askImpl,
  };
  return { ops, calls };
}

const thread = () => ({ selector: { exact: "x" }, section: "", messages: [] });

describe("threadTurn.run", () => {
  it("runs a successful turn: append, stream, persist, return final text", async () => {
    const { ops, calls } = makeOps(async (_t, { onChunk }) => {
      onChunk("Par");
      onChunk("Partial answer.");
      return "Partial answer.";
    });
    const t = thread();
    const result = await threadTurn.run(t, "why?", ops);

    expect(result).toBe("Partial answer.");
    expect(t.messages).toEqual([
      expect.objectContaining({ role: "user", text: "why?" }),
      expect.objectContaining({ role: "model", text: "Partial answer." }),
    ]);
    const names = calls.map((c) => c[0]);
    expect(names).toEqual([
      "appendUser",
      "persist",
      "setLoading", // true
      "beginModel",
      "renderModel", // "Par"
      "renderModel", // "Partial answer."
      "renderModel", // final
      "endModel",
      "setLoading", // false
      "persist",
    ]);
    expect(calls.filter((c) => c[0] === "setLoading").map((c) => c[1])).toEqual([true, false]);
  });

  it("renders a ⚠️ message and still resolves when ask rejects", async () => {
    const { ops, calls } = makeOps(async () => {
      throw new Error("network down");
    });
    const t = thread();
    const result = await threadTurn.run(t, "why?", ops);

    expect(result).toContain("network down");
    expect(t.messages[1]).toMatchObject({ role: "model", error: true });
    // loading is always turned off, model message always finalized
    expect(calls.filter((c) => c[0] === "setLoading").map((c) => c[1])).toEqual([true, false]);
    expect(calls.some((c) => c[0] === "endModel")).toBe(true);
  });

  it("an aborted turn keeps the partial text as a normal message, no ⚠️", async () => {
    const { ops, calls } = makeOps(async (_t, { onChunk }) => {
      onChunk("partial ans");
      const e = new Error("Cancelled.");
      e.name = "AbortError";
      throw e;
    });
    const t = thread();
    await threadTurn.run(t, "why?", ops);

    expect(t.messages).toEqual([
      expect.objectContaining({ role: "user", text: "why?" }),
      expect.objectContaining({ role: "model", text: "partial ans", stopped: true }),
    ]);
    expect(t.messages[1].error).toBeUndefined();
    // invariants: model finalized, loading off, persisted
    expect(calls.some((c) => c[0] === "endModel")).toBe(true);
    expect(calls.filter((c) => c[0] === "setLoading").map((c) => c[1])).toEqual([true, false]);
    expect(calls.filter((c) => c[0] === "persist")).toHaveLength(2);
    // no ⚠️ was rendered
    expect(calls.some((c) => c[0] === "renderModel" && String(c[1]).indexOf("⚠️") === 0)).toBe(
      false,
    );
  });

  it("an abort before any text arrived records no model message", async () => {
    const { ops } = makeOps(async () => {
      const e = new Error("Cancelled.");
      e.name = "AbortError";
      throw e;
    });
    const t = thread();
    await threadTurn.run(t, "why?", ops);
    expect(t.messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("does not let a persist failure reject the turn", async () => {
    const { ops } = makeOps(async () => "ok");
    ops.persist = () => {
      throw new Error("storage full");
    };
    await expect(threadTurn.run(thread(), "q", ops)).resolves.toBe("ok");
  });

  it("prefers ops.renderError for failures and stores the raw message", async () => {
    const { ops, calls } = makeOps(async () => {
      throw new Error("boom");
    });
    ops.renderError = (h, msg) => calls.push(["renderError", msg]);
    const t = thread();
    await threadTurn.run(t, "why?", ops);
    expect(calls.some((c) => c[0] === "renderError" && c[1] === "boom")).toBe(true);
    expect(calls.some((c) => c[0] === "renderModel" && String(c[1]).indexOf("⚠️") === 0)).toBe(
      false,
    );
    expect(t.messages[1]).toMatchObject({ role: "model", text: "boom", error: true });
  });
});

describe("threadTurn.retry", () => {
  it("drops the trailing error message and re-asks without re-adding the question", async () => {
    const { ops, calls } = makeOps(async (_t, { onChunk }) => {
      onChunk("recovered");
      return "recovered answer";
    });
    const t = thread();
    t.messages.push({ role: "user", text: "why?", ts: 1 });
    t.messages.push({ role: "model", text: "boom", ts: 2, error: true });

    const result = await threadTurn.retry(t, ops);
    expect(result).toBe("recovered answer");
    expect(t.messages.map((m) => m.role)).toEqual(["user", "model"]);
    expect(t.messages[1]).toMatchObject({ text: "recovered answer" });
    expect(t.messages[1].error).toBeUndefined();
    expect(calls.filter((c) => c[0] === "appendUser")).toHaveLength(0); // question not duplicated
    expect(calls.filter((c) => c[0] === "setLoading").map((c) => c[1])).toEqual([true, false]);
  });

  it("a failing retry stacks a fresh error message (still recoverable)", async () => {
    const { ops } = makeOps(async () => {
      throw new Error("still down");
    });
    const t = thread();
    t.messages.push({ role: "user", text: "why?", ts: 1 });
    t.messages.push({ role: "model", text: "boom", ts: 2, error: true });
    await threadTurn.retry(t, ops);
    expect(t.messages.map((m) => m.role)).toEqual(["user", "model"]);
    expect(t.messages[1]).toMatchObject({ text: "still down", error: true });
  });
});

describe("markdown flag", () => {
  it("run() stamps md:true from opts onto the stored user message (absent otherwise)", async () => {
    const { ops } = makeOps(async () => "ok");
    const t = thread();
    await threadTurn.run(t, "with md", ops, { md: true });
    await threadTurn.run(t, "without", ops);
    const users = t.messages.filter((m) => m.role === "user");
    expect(users[0].md).toBe(true);
    expect("md" in users[1]).toBe(false);
  });
});

// ---- issue #8: provider override ----------------------------------------
describe("threadTurn provider override", () => {
  it("stamps opts.provider on the question and the reply, and forwards it to ops.ask", async () => {
    let seen;
    const { ops } = makeOps(async (_t, o) => {
      seen = o.provider;
      return "hi";
    });
    const t = thread();
    await threadTurn.run(t, "q", ops, { provider: "gemini" });
    expect(seen).toBe("gemini");
    expect(t.messages[0]).toMatchObject({ role: "user", provider: "gemini" });
    expect(t.messages[1]).toMatchObject({ role: "model", text: "hi", provider: "gemini" });
  });

  it("leaves records untouched (no provider key) on the default path", async () => {
    let seen = "unset";
    const { ops } = makeOps(async (_t, o) => {
      seen = o.provider;
      return "hi";
    });
    const t = thread();
    await threadTurn.run(t, "q", ops, { md: true });
    expect(seen).toBeUndefined();
    expect("provider" in t.messages[0]).toBe(false);
    expect("provider" in t.messages[1]).toBe(false);
  });

  it("stamps stopped and error replies too", async () => {
    const abort = Object.assign(new Error("x"), { name: "AbortError" });
    const { ops } = makeOps(async (_t, { onChunk }) => {
      onChunk("part");
      throw abort;
    });
    const t = thread();
    await threadTurn.run(t, "q", ops, { provider: "chatgpt" });
    expect(t.messages[1]).toMatchObject({ stopped: true, provider: "chatgpt" });

    const { ops: ops2 } = makeOps(async () => {
      throw new Error("boom");
    });
    const t2 = thread();
    await threadTurn.run(t2, "q", ops2, { provider: "chatgpt" });
    expect(t2.messages[1]).toMatchObject({ error: true, provider: "chatgpt" });
  });

  it("retry re-asks the provider of the last question", async () => {
    let seen;
    const { ops } = makeOps(async (_t, o) => {
      seen = o.provider;
      return "ok";
    });
    const t = thread();
    t.messages.push(
      { role: "user", text: "q", provider: "gemini" },
      { role: "model", text: "fail", error: true, provider: "gemini" },
    );
    await threadTurn.retry(t, ops);
    expect(seen).toBe("gemini");
    expect(t.messages[1]).toMatchObject({ text: "ok", provider: "gemini" });
  });
});

// ---- research mode --------------------------------------------------------
// Research resolves its provider through GA.core.sites.researchOption, so these
// cases load the real sites table into one shared GA.
function researchGA(settings) {
  const GA = loadGA(["src/core/sites.js", "src/content/thread-turn.js"]);
  GA.settings =
    settings === undefined ? { researchProvider: "anthropic", anthropicApiKey: "k" } : settings;
  return GA;
}

function researchOps(askImpl) {
  const made = makeOps(askImpl);
  made.ops.beginModel = (meta) => {
    made.calls.push(["beginModel", meta]);
    return { rendered: [] };
  };
  made.ops.renderModel = (h, t, extra) => {
    made.calls.push(["renderModel", t, extra]);
    h.rendered.push(t);
  };
  made.ops.renderStep = (h, step) => made.calls.push(["renderStep", step]);
  made.ops.renderError = (h, msg) => made.calls.push(["renderError", msg]);
  return made;
}

const SOURCES = [
  { n: 1, title: "One", url: "https://one.example", read: true, cited: true, snippet: "s" },
  { n: 2, title: "Two", url: "https://two.example", read: false, cited: false },
];

describe("threadTurn research", () => {
  it("stamps both messages, forwards steps, and saves trimmed sources on the reply", async () => {
    const GA = researchGA();
    let seen;
    const { ops, calls } = researchOps(async (_t, o) => {
      seen = o;
      o.onStep({ kind: "search", step: 1, query: "q" });
      o.onChunk("Ans");
      return {
        text: "Answer [1]",
        research: { model: "m1", provider: "claude", sources: SOURCES },
      };
    });
    const t = thread();
    const out = await GA.threadTurn.run(t, "why?", ops, { md: true, research: true });
    expect(out).toBe("Answer [1]");
    expect(seen).toMatchObject({ provider: "claude", research: true });
    expect(calls.find((c) => c[0] === "beginModel")[1]).toEqual({
      provider: "claude",
      research: true,
    });
    expect(calls.filter((c) => c[0] === "renderStep")).toEqual([
      ["renderStep", { kind: "search", step: 1, query: "q" }],
    ]);
    const research = {
      model: "m1",
      sources: [
        { n: 1, title: "One", url: "https://one.example" },
        { n: 2, title: "Two", url: "https://two.example" },
      ],
    };
    const finalRender = calls.filter((c) => c[0] === "renderModel").pop();
    expect(finalRender).toEqual(["renderModel", "Answer [1]", { research }]);
    expect(t.messages[0]).toMatchObject({
      role: "user",
      md: true,
      research: true,
      provider: "claude",
    });
    expect(t.messages[1]).toMatchObject({
      role: "model",
      text: "Answer [1]",
      provider: "claude",
      research,
    });
  });

  it("a stopped run keeps the partial text as stopped, no error", async () => {
    const GA = researchGA();
    const { ops } = researchOps(async (_t, o) => {
      o.onChunk("part");
      return { text: "part", research: null, stopped: true };
    });
    const t = thread();
    await GA.threadTurn.run(t, "q", ops, { research: true });
    expect(t.messages[1]).toMatchObject({
      role: "model",
      text: "part",
      stopped: true,
      research: {},
    });
    expect(t.messages[1].error).toBeUndefined();
  });

  it("an aborted run keeps partial text", async () => {
    const GA = researchGA();
    const { ops } = researchOps(async (_t, o) => {
      o.onChunk("half");
      throw Object.assign(new Error("Cancelled."), { name: "AbortError" });
    });
    const t = thread();
    await GA.threadTurn.run(t, "q", ops, { research: true });
    expect(t.messages[1]).toMatchObject({ text: "half", stopped: true });
  });

  it("errors render an error card and store the raw message", async () => {
    const GA = researchGA();
    const { ops, calls } = researchOps(async () => {
      throw new Error("HTTP 400: model has no tools");
    });
    const t = thread();
    await GA.threadTurn.run(t, "q", ops, { research: true });
    expect(calls.some((c) => c[0] === "renderError" && /no tools/.test(c[1]))).toBe(true);
    expect(t.messages[1]).toMatchObject({ error: true, provider: "claude" });
  });

  it("a lost connection mid-run names the last step seen", async () => {
    const GA = researchGA();
    const { ops, calls } = researchOps(async (_t, o) => {
      o.onStep({ kind: "step", step: 3, maxSteps: 8 });
      throw Object.assign(new Error("Connection to extension closed."), { code: "DISCONNECTED" });
    });
    const t = thread();
    await GA.threadTurn.run(t, "q", ops, { research: true });
    expect(calls.find((c) => c[0] === "renderError")[1]).toBe("Connection lost after step 3.");
  });

  it("with no research provider configured it errors without asking", async () => {
    const GA = researchGA({});
    let asked = false;
    const { ops, calls } = researchOps(async () => {
      asked = true;
      return "x";
    });
    const t = thread();
    await GA.threadTurn.run(t, "q", ops, { research: true });
    expect(asked).toBe(false);
    expect(t.messages[0]).toMatchObject({ research: true });
    expect("provider" in t.messages[0]).toBe(false);
    expect(calls.find((c) => c[0] === "renderError")[1]).toMatch(/research provider/);
    expect(t.messages[1]).toMatchObject({ error: true });
  });

  it("retry re-runs research when the last question was a research one", async () => {
    const GA = researchGA();
    let seen;
    const { ops } = researchOps(async (_t, o) => {
      seen = o;
      return { text: "ok [1]", research: { model: "m", sources: SOURCES.slice(0, 1) } };
    });
    const t = thread();
    t.messages.push(
      { role: "user", text: "q", research: true, provider: "claude" },
      { role: "model", text: "fail", error: true, provider: "claude" },
    );
    await GA.threadTurn.retry(t, ops);
    expect(seen).toMatchObject({ research: true, provider: "claude" });
    expect(t.messages.map((m) => m.role)).toEqual(["user", "model"]);
    expect(t.messages[1].research.sources).toHaveLength(1);
  });

  it("a plain string result (no research summary) still completes", async () => {
    const GA = researchGA();
    const { ops } = researchOps(async () => "plain");
    const t = thread();
    await GA.threadTurn.run(t, "q", ops, { research: true });
    expect(t.messages[1]).toMatchObject({ text: "plain", research: { model: null, sources: [] } });
  });
});
