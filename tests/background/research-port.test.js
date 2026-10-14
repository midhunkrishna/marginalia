import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// background.js port handler: `research: true` asks go to GA.research.run
// (steps as MSG_STEP frames, chunks through the shared delta relay, MSG_DONE
// carrying `research`); every other ask still goes to clientFor().ask().

function setup() {
  let onConnect;
  const browser = {
    runtime: {
      id: "ext-id",
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onConnect: {
        addListener(fn) {
          onConnect = fn;
        },
      },
      onMessage: { addListener() {} },
    },
    contextMenus: {
      removeAll: () => Promise.resolve(),
      create() {},
      onClicked: { addListener() {} },
    },
    tabs: { sendMessage: () => Promise.resolve() },
    storage: { local: { get: () => Promise.resolve({}) } },
  };
  const GA = loadGA(
    [
      "src/shared/protocol.js",
      "src/shared/hosts.js",
      "src/shared/settings-schema.js",
      "src/shared/config.js",
      "src/shared/stream-delta.js",
      "src/background.js",
    ],
    { browser },
  );
  const posted = [];
  let onMsg;
  const port = {
    name: GA.protocol.PORT_ASK,
    postMessage: (m) => posted.push(m),
    onDisconnect: { addListener() {} },
    onMessage: {
      addListener(fn) {
        onMsg = fn;
      },
    },
  };
  onConnect(port);
  return { GA, posted, send: (m) => onMsg(m) };
}

describe("background ask port: research branch", () => {
  it("routes research asks to GA.research.run and relays steps, chunks and done", async () => {
    const { GA, posted, send } = setup();
    let seen;
    GA.clientFor = () => {
      throw new Error("single-shot path must not run");
    };
    GA.research = {
      async run(opts) {
        seen = opts;
        opts.onStep({ kind: "search", step: 1, query: "q" });
        opts.onText("Pre");
        opts.onText("");
        opts.onText("Answer");
        opts.onText("Answer [1]");
        return { text: "Answer [1]", research: { provider: "claude", model: "m", sources: [] } };
      },
    };
    await send({ type: GA.protocol.MSG_ASK, provider: "gemini", prompt: "P", research: true });
    expect(seen.prompt).toBe("P");
    expect(seen.signal).toBeDefined();
    expect(seen.settings).toMatchObject(GA.schema.DEFAULT_SETTINGS);
    const P = GA.protocol;
    expect(posted.filter((m) => m.type !== P.MSG_PING)).toEqual([
      { type: P.MSG_STEP, kind: "search", step: 1, query: "q" },
      { type: P.MSG_CHUNK, delta: "Pre" },
      { type: P.MSG_CHUNK, reset: true, text: "" },
      { type: P.MSG_CHUNK, delta: "Answer" },
      { type: P.MSG_CHUNK, delta: " [1]" },
      {
        type: P.MSG_DONE,
        text: "Answer [1]",
        research: { provider: "claude", model: "m", sources: [] },
      },
    ]);
  });

  it("research errors post MSG_ERROR like any ask", async () => {
    const { GA, posted, send } = setup();
    GA.research = {
      run: async () => {
        throw new Error("Pick a research provider in Marginalia's options.");
      },
    };
    await send({ type: GA.protocol.MSG_ASK, prompt: "P", research: true });
    expect(posted).toContainEqual({
      type: GA.protocol.MSG_ERROR,
      message: "Pick a research provider in Marginalia's options.",
      code: undefined,
    });
  });

  it("plain asks still go through clientFor().ask() with the delta relay", async () => {
    const { GA, posted, send } = setup();
    GA.research = {
      run: async () => {
        throw new Error("research path must not run");
      },
    };
    let req;
    GA.clientFor = (provider) => ({
      async ask(r, onChunk) {
        req = Object.assign({ provider }, r);
        onChunk("a");
        onChunk("ab");
        return "ab";
      },
    });
    await send({ type: GA.protocol.MSG_ASK, provider: "claude", prompt: "P", tokens: null });
    expect(req).toMatchObject({ provider: "claude", prompt: "P" });
    const P = GA.protocol;
    expect(posted.filter((m) => m.type !== P.MSG_PING)).toEqual([
      { type: P.MSG_CHUNK, delta: "a" },
      { type: P.MSG_CHUNK, delta: "b" },
      { type: P.MSG_DONE, text: "ab" },
    ]);
  });
});
