// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";
import { makeStorageFake } from "../helpers/storage-mock.js";

// Options-page Test button + live model dropdown (issue #2): drives the REAL
// options.js state machine against a fake browser.runtime.sendMessage returning
// canned background responses. options.js reads its elements and calls load()
// at eval time, so the DOM must exist BEFORE loadGA evaluates it.

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  await tick();
  await tick();
  await tick();
};

function fixture() {
  const providerRow = (p, placeholder) => `
    <div class="provider">
      <h3>${p}</h3>
      <input type="password" id="${p}-key" class="key" />
      <div class="model-cell">
        <select id="${p}-model-select" class="model" hidden></select>
        <input type="text" id="${p}-model" class="model" placeholder="${placeholder}" />
      </div>
      <div class="test-row">
        <button id="${p}-test" class="ghost test" type="button">Test</button>
        <span id="${p}-test-status" class="status test-status"></span>
      </div>
    </div>`;
  // Every element options.js's `els` map resolves at eval time, plus the
  // provider rows the key-test wiring binds to.
  document.body.innerHTML = `
    <button id="shortcut-btn"></button>
    <button id="shortcut-reset"></button>
    <p id="shortcut-status"></p>
    <input type="checkbox" id="adder" />
    <input type="checkbox" id="calm-scroll" />
    <input type="checkbox" id="debug" />
    ${providerRow("openai", "gpt-4o-mini")}
    ${providerRow("gemini", "gemini-2.5-flash")}
    ${providerRow("anthropic", "claude-sonnet-4-6")}
    ${providerRow("openrouter", "anthropic/claude-sonnet-4.6")}
    <p id="apikeys-status"></p>
    <button id="clear-btn"></button>
    <p id="clear-status"></p>
    <button id="export-btn"></button>
    <button id="import-btn"></button>
    <input type="file" id="import-file" hidden />
    <input type="checkbox" id="import-replace" />
    <p id="backup-status"></p>`;
}

// respond: (msg) => canned background response (or a Promise of one).
// Async: options.js's eval-time load() resolves on a microtask and its render()
// overwrites the inputs from stored settings — tests must let that settle
// BEFORE typing into inputs, exactly like a real page (loaded long before any
// user interaction).
async function setup({ initial = {}, respond = () => ({ ok: true, ms: 1 }) } = {}) {
  fixture();
  const sent = [];
  const runtime = {
    sendMessage: (msg) => {
      sent.push(msg);
      return Promise.resolve(respond(msg));
    },
  };
  const store = makeStorageFake({ initial, runtime });
  const GA = loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/protocol.js",
      "src/core/backup.js",
      "src/options/options.js",
    ],
    { browser: store.browser },
  );
  await tick();
  const el = (id) => document.getElementById(id);
  return { GA, store, sent, el };
}

const status = (p) => document.getElementById(p + "-test-status");

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("options Test button", () => {
  it("requires a key before spending any quota", async () => {
    const { sent, el } = await setup();
    el("openai-test").click();
    await settle();
    expect(sent).toHaveLength(0);
    expect(status("openai").textContent).toBe("Enter an API key first.");
    expect(status("openai").classList.contains("bad")).toBe(true);
  });

  it("shows Testing… then a green Key OK line with round-trip ms", async () => {
    let resolveTest;
    const { GA, sent, el } = await setup({
      respond: (msg) => {
        if (msg.type === "ga-test-key") return new Promise((r) => (resolveTest = r));
        return { ok: false, status: 0, message: "no list" };
      },
    });
    el("openai-key").value = " sk-live ";
    el("openai-model").value = "gpt-4o-mini";
    el("openai-test").click();
    await tick();
    expect(status("openai").textContent).toBe("Testing…");
    expect(el("openai-test").disabled).toBe(true);
    expect(sent[0]).toEqual({
      type: GA.protocol.MSG_TEST_KEY,
      provider: "openai",
      key: "sk-live", // trimmed
      model: "gpt-4o-mini",
    });
    resolveTest({ ok: true, model: "gpt-4o-mini", ms: 412 });
    await settle();
    expect(status("openai").textContent).toContain("✓ Key OK — gpt-4o-mini reachable (412 ms)");
    expect(status("openai").classList.contains("ok")).toBe(true);
    expect(el("openai-test").disabled).toBe(false);
  });

  it("uses the schema default model when the input is empty", async () => {
    const { sent, el } = await setup({
      respond: (msg) =>
        msg.type === "ga-test-key" ? { ok: true, ms: 1 } : { ok: false, status: 0 },
    });
    el("gemini-key").value = "AIza-k";
    el("gemini-test").click();
    await settle();
    expect(sent[0].model).toBe("gemini-2.5-flash");
  });

  it("maps 401 to the key-rejected phrasing", async () => {
    const { el } = await setup({
      respond: () => ({ ok: false, status: 401, detail: "Incorrect API key", message: "…" }),
    });
    el("openai-key").value = "sk-bad";
    el("openai-test").click();
    await settle();
    expect(status("openai").textContent).toBe(
      "✗ HTTP 401 — key rejected. Check for extra spaces or an expired key.",
    );
    expect(status("openai").classList.contains("bad")).toBe(true);
  });

  it("maps Gemini's HTTP 400 'API key not valid' to the key-rejected phrasing", async () => {
    const { el } = await setup({
      respond: () => ({
        ok: false,
        status: 400,
        detail: "API key not valid. Please pass a valid API key.",
        message: "…",
      }),
    });
    el("gemini-key").value = "AIza-bad";
    el("gemini-test").click();
    await settle();
    expect(status("gemini").textContent).toBe(
      "✗ HTTP 400 — key rejected. Check for extra spaces or an expired key.",
    );
  });

  it("404 fetches the list anyway, suggests the near-miss id, and populates the dropdown", async () => {
    const { GA, sent, el } = await setup({
      respond: (msg) =>
        msg.type === GA?.protocol?.MSG_LIST_MODELS || msg.type === "ga-list-models"
          ? {
              ok: true,
              models: [
                { id: "gpt-4o-mini", created: 2 },
                { id: "gpt-4o", created: 1 },
              ],
            }
          : { ok: false, status: 404, detail: "The model `gpt4o-mini` does not exist" },
    });
    el("openai-key").value = "sk-live";
    el("openai-model").value = "gpt4o-mini";
    el("openai-test").click();
    await settle();
    expect(status("openai").textContent).toBe(
      '✗ HTTP 404 — model "gpt4o-mini" not found. Did you mean "gpt-4o-mini"?',
    );
    expect(sent.map((m) => m.type)).toEqual(["ga-test-key", "ga-list-models"]);
    const select = el("openai-model-select");
    expect(select.hidden).toBe(false);
    expect([...select.options].map((o) => o.value)).toEqual(["gpt-4o-mini", "gpt-4o", "__other__"]);
  });

  it("discards a verdict earned by a key that was edited mid-test", async () => {
    let resolveTest;
    const { sent, el } = await setup({
      respond: (msg) => {
        if (msg.type === "ga-test-key") return new Promise((r) => (resolveTest = r));
        return { ok: true, models: [{ id: "gpt-4o", created: 1 }] };
      },
    });
    el("openai-key").value = "sk-old";
    el("openai-test").click();
    await tick();
    el("openai-key").value = "sk-new"; // user pastes a different key mid-flight
    resolveTest({ ok: true, model: "gpt-4o-mini", ms: 9 });
    await settle();
    expect(status("openai").textContent).toBe("Key changed while testing — click Test again.");
    expect(status("openai").classList.contains("ok")).toBe(false);
    // no dropdown from the old key's account, no list fetch at all
    expect(el("openai-model-select").hidden).toBe(true);
    expect(sent.filter((m) => m.type === "ga-list-models")).toHaveLength(0);
    expect(el("openai-test").disabled).toBe(false); // ready to re-test
  });

  it("shows a network-error line for status 0 without touching saved settings", async () => {
    const { store, el } = await setup({
      initial: { "ga:settings": { anthropicApiKey: "sk-ant" } },
      respond: () => ({ ok: false, status: 0, detail: "", message: "Network error." }),
    });
    el("anthropic-key").value = "sk-ant";
    el("anthropic-test").click();
    await settle();
    expect(status("anthropic").textContent).toBe("✗ Network error.");
    expect(store.setCalls).toHaveLength(0);
  });
});

describe("options model dropdown", () => {
  const LIST = {
    ok: true,
    models: [
      { id: "claude-sonnet-4-6", created: 3 },
      { id: "claude-opus-4-1", created: 2 },
    ],
  };

  function okSetup(initial) {
    return setup({
      initial,
      respond: (msg) => (msg.type === "ga-list-models" ? LIST : { ok: true, ms: 5 }),
    });
  }

  it("after Key OK: select appears newest-first with a trailing Other…, input hides", async () => {
    const { el } = await okSetup({ "ga:settings": { anthropicModel: "claude-sonnet-4-6" } });
    el("anthropic-key").value = "sk-ant";
    el("anthropic-test").click();
    await settle();
    const select = el("anthropic-model-select");
    expect(select.hidden).toBe(false);
    expect([...select.options].map((o) => o.value)).toEqual([
      "claude-sonnet-4-6",
      "claude-opus-4-1",
      "__other__",
    ]);
    expect(select.value).toBe("claude-sonnet-4-6"); // current model preselected
    expect(el("anthropic-model").hidden).toBe(true);
  });

  it("an unlisted saved model preselects Other… and keeps the input visible", async () => {
    const { el } = await okSetup({ "ga:settings": { anthropicModel: "claude-legacy-1" } });
    el("anthropic-key").value = "sk-ant";
    el("anthropic-test").click();
    await settle();
    expect(el("anthropic-model-select").value).toBe("__other__");
    expect(el("anthropic-model").hidden).toBe(false);
  });

  it("choosing a model saves it; choosing Other… re-reveals the input without saving", async () => {
    const { store, el } = await okSetup();
    el("anthropic-key").value = "sk-ant";
    el("anthropic-test").click();
    await settle();
    const select = el("anthropic-model-select");
    select.value = "claude-opus-4-1";
    select.dispatchEvent(new Event("change"));
    await settle();
    expect(store.setCalls).toHaveLength(1);
    expect(store.data["ga:settings"].anthropicModel).toBe("claude-opus-4-1");
    expect(document.getElementById("apikeys-status").textContent).toBe("Saved.");
    expect(el("anthropic-model").hidden).toBe(true);

    const before = store.setCalls.length;
    select.value = "__other__";
    select.dispatchEvent(new Event("change"));
    await settle();
    expect(el("anthropic-model").hidden).toBe(false);
    expect(store.setCalls).toHaveLength(before); // Other… itself saves nothing
    // …and the revealed input shows the model actually in use, not a stale id.
    expect(el("anthropic-model").value).toBe("claude-opus-4-1");
  });

  it("populating the select syncs the hidden input to the active model", async () => {
    const { el } = await okSetup({ "ga:settings": { anthropicModel: "claude-sonnet-4-6" } });
    el("anthropic-model").value = "something-stale";
    el("anthropic-key").value = "sk-ant";
    el("anthropic-test").click();
    await settle();
    expect(el("anthropic-model").value).toBe("claude-sonnet-4-6");
  });

  it("a second Test with the same key reuses the session cache (one list fetch)", async () => {
    const { sent, el } = await okSetup();
    el("anthropic-key").value = "sk-ant";
    el("anthropic-test").click();
    await settle();
    el("anthropic-test").click();
    await settle();
    expect(sent.filter((m) => m.type === "ga-list-models")).toHaveLength(1);
    // …and an edited key invalidates it.
    el("anthropic-key").value = "sk-ant-2";
    el("anthropic-test").click();
    await settle();
    expect(sent.filter((m) => m.type === "ga-list-models")).toHaveLength(2);
  });

  it("a failed list fetch keeps free-text and the debounced save path working", async () => {
    const { store, el } = await setup({
      respond: (msg) =>
        msg.type === "ga-list-models"
          ? { ok: false, status: 500, message: "boom" }
          : { ok: true, ms: 5 },
    });
    el("openai-key").value = "sk-live";
    el("openai-test").click();
    await settle();
    expect(status("openai").textContent).toContain("model list unavailable");
    expect(status("openai").classList.contains("ok")).toBe(true); // key itself is fine
    expect(el("openai-model-select").hidden).toBe(true);
    expect(el("openai-model").hidden).toBe(false);

    // typing a model id still saves through the existing debounced handler
    el("openai-model").value = "gpt-4o";
    el("openai-model").dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 450));
    expect(store.data["ga:settings"].openaiModel).toBe("gpt-4o");
  });

  it("a rejecting sendMessage degrades to the network-error line, no unhandled rejection", async () => {
    fixture();
    const store = makeStorageFake({
      runtime: { sendMessage: () => Promise.reject(new Error("worker gone")) },
    });
    loadGA(
      [
        "src/shared/settings-schema.js",
        "src/shared/protocol.js",
        "src/core/backup.js",
        "src/options/options.js",
      ],
      { browser: store.browser },
    );
    await tick(); // let eval-time load()/render() settle, as in setup()
    const el = (id) => document.getElementById(id);
    el("openai-key").value = "sk-live";
    el("openai-test").click();
    await settle();
    expect(status("openai").textContent).toBe("✗ Network error.");
  });
});

describe("options OpenRouter row", () => {
  const LIST = {
    ok: true,
    models: [
      { id: "anthropic/claude-sonnet-4.6", created: 3, tools: true },
      { id: "some/base-model", created: 2, tools: false },
      { id: "openai/gpt-4o", created: 1 },
    ],
  };

  it("Test sends MSG_TEST_KEY with the row id and the schema default model", async () => {
    const { GA, sent, el } = await setup({
      respond: (msg) => (msg.type === "ga-list-models" ? LIST : { ok: true, ms: 7 }),
    });
    el("openrouter-key").value = " sk-or-1 ";
    el("openrouter-test").click();
    await settle();
    expect(sent[0]).toEqual({
      type: GA.protocol.MSG_TEST_KEY,
      provider: "openrouter",
      key: "sk-or-1",
      model: "anthropic/claude-sonnet-4.6",
    });
    expect(sent[1]).toEqual({
      type: GA.protocol.MSG_LIST_MODELS,
      provider: "openrouter",
      key: "sk-or-1",
    });
    expect(status("openrouter").textContent).toContain(
      "✓ Key OK — anthropic/claude-sonnet-4.6 reachable (7 ms)",
    );
  });

  it("dropdown suffixes tool-less models with (no tools) but keeps bare ids as values", async () => {
    const { el } = await setup({
      respond: (msg) => (msg.type === "ga-list-models" ? LIST : { ok: true, ms: 7 }),
    });
    el("openrouter-key").value = "sk-or-1";
    el("openrouter-test").click();
    await settle();
    const select = el("openrouter-model-select");
    expect(select.hidden).toBe(false);
    expect([...select.options].map((o) => o.value)).toEqual([
      "anthropic/claude-sonnet-4.6",
      "some/base-model",
      "openai/gpt-4o",
      "__other__",
    ]);
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "anthropic/claude-sonnet-4.6",
      "some/base-model (no tools)",
      "openai/gpt-4o",
      "Other…",
    ]);
    expect(select.value).toBe("anthropic/claude-sonnet-4.6");
  });

  it("picking a model saves openrouterModel", async () => {
    const { store, el } = await setup({
      respond: (msg) => (msg.type === "ga-list-models" ? LIST : { ok: true, ms: 7 }),
    });
    el("openrouter-key").value = "sk-or-1";
    el("openrouter-test").click();
    await settle();
    const select = el("openrouter-model-select");
    select.value = "openai/gpt-4o";
    select.dispatchEvent(new Event("change"));
    await settle();
    expect(store.data["ga:settings"].openrouterModel).toBe("openai/gpt-4o");
  });
});
