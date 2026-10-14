// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";
import { makeStorageFake } from "../helpers/storage-mock.js";
import { makeInjectedDownloadStub } from "../helpers/download-stub.js";

// Options-page Export / Import UI (T-008): drives the REAL options.js handlers
// against a fake `browser.storage.local`, fake URL object-URL registry, and a
// stubbed confirm(). options.js reads its elements and calls load() at eval
// time, so the DOM and the fake storage must exist BEFORE loadGA evaluates it.

const tick = () => new Promise((r) => setTimeout(r, 0));
const clone = (x) => JSON.parse(JSON.stringify(x));

const thread = (id, msgCount = 1) => ({
  id,
  messages: Array.from({ length: msgCount }, (_, i) => ({ role: "user", text: id + "-m" + i })),
  resolved: false,
});

// Shared storage fake, JSON-clone flavor: every byte that passes through
// set/get must survive JSON serialization, like a real backup archive.
const fakeStorage = (initial, opts = {}) =>
  makeStorageFake({ initial, clone: "json", failSet: opts.failSet });

function setup({ initial = {}, failSet = "", confirmResult = true } = {}) {
  // Every element options.js's `els` map resolves at eval time.
  document.body.innerHTML = `
    <button id="shortcut-btn"></button>
    <button id="shortcut-reset"></button>
    <p id="shortcut-status"></p>
    <input type="checkbox" id="adder" />
    <input type="checkbox" id="calm-scroll" />
    <input type="checkbox" id="debug" />
    <p id="apikeys-status"></p>
    <button id="clear-btn"></button>
    <p id="clear-status"></p>
    <button id="export-btn"></button>
    <button id="import-btn"></button>
    <input type="file" id="import-file" accept="application/json" hidden />
    <input type="checkbox" id="import-replace" />
    <p id="backup-status"></p>`;

  const store = fakeStorage(initial, { failSet });
  const { fakeURL, created, revoked, anchorClicks } = makeInjectedDownloadStub();
  const confirms = [];

  const GA = loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/copy.js",
      "src/core/backup.js",
      "src/core/quick-actions.js",
      "src/options/options.js",
    ],
    {
      browser: store.browser,
      Blob: globalThis.Blob,
      URL: fakeURL,
      confirm: (msg) => {
        confirms.push(msg);
        return confirmResult;
      },
    },
  );
  const el = (id) => document.getElementById(id);
  return { GA, store, created, revoked, confirms, anchorClicks, el };
}

async function importText(text) {
  const input = document.getElementById("import-file");
  const file = { name: "backup.json", text: async () => text };
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
  await tick();
  await tick();
}

const status = () => document.getElementById("backup-status").textContent;

const SEEDED = {
  "ga:settings": { openaiApiKey: "sk-SECRET", scope: "section" },
  "ga:threads:gemini:s1": [thread("t1", 2), thread("t2")],
  "ga:threads:claude:s9": [thread("t3")],
  "ga:convo:gemini:conv1": {
    provider: "gemini",
    id: "conv1",
    capturedAt: 1000,
    turns: [{ role: "user", fp: { hash: "h1", len: 5 }, order: 0 }],
    blobs: { "h1:5": "Zm9vYmFy" },
  },
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("options export", () => {
  it("downloads a v1 envelope Blob named marginalia-threads-YYYYMMDD.json and reports counts", async () => {
    const { created, revoked, anchorClicks, el } = setup({ initial: SEEDED });
    el("export-btn").click();
    await tick();
    await tick();

    expect(created).toHaveLength(1);
    expect(created[0]).toBeInstanceOf(Blob);
    expect(created[0].type).toBe("application/json");
    const env = JSON.parse(await created[0].text());
    expect(env.format).toBe("marginalia-threads");
    expect(env.version).toBe(1);
    expect(typeof env.exportedAt).toBe("number");
    expect(Object.keys(env.threads).sort()).toEqual([
      "ga:threads:claude:s9",
      "ga:threads:gemini:s1",
    ]);
    expect(env.convos["ga:convo:gemini:conv1"].blobs["h1:5"]).toBe("Zm9vYmFy");

    expect(anchorClicks).toHaveLength(1);
    expect(anchorClicks[0].download).toMatch(/^marginalia-threads-\d{8}\.json$/);
    expect(revoked).toEqual(["blob:fake-1"]);
    expect(status()).toBe("Exported 3 thread(s) from 2 conversation(s).");
  });

  it("never leaks the settings / API-key record into the archive", async () => {
    const { created, el } = setup({ initial: SEEDED });
    el("export-btn").click();
    await tick();
    await tick();
    const text = await created[0].text();
    expect(text).not.toContain("sk-SECRET");
    expect(text).not.toContain("ga:settings");
  });

  it("a throwing buildExport lands in the status line, no download, no unhandled rejection", async () => {
    const { GA, created, el } = setup({ initial: SEEDED });
    GA.core.backup.buildExport = () => {
      throw new Error("boom");
    };
    el("export-btn").click();
    await tick();
    await tick();
    expect(status()).toBe("Export failed: boom");
    expect(created).toHaveLength(0);
  });

  it("a rejecting storage.get lands in the status line", async () => {
    const { store, created, el } = setup({ initial: SEEDED });
    store.browser.storage.local.get = async () => {
      throw new Error("storage gone");
    };
    el("export-btn").click();
    await tick();
    await tick();
    expect(status()).toBe("Export failed: storage gone");
    expect(created).toHaveLength(0);
  });
});

describe("options import — merge", () => {
  it("Import button forwards to the hidden file input", () => {
    const { el } = setup();
    let clicked = 0;
    el("import-file").addEventListener("click", (e) => {
      clicked++;
      e.preventDefault();
    });
    el("import-btn").click();
    expect(clicked).toBe(1);
  });

  it("round-trips an exported archive: merge is a superset, settings untouched, re-import idempotent", async () => {
    // Export from the seeded store…
    const exporter = setup({ initial: SEEDED });
    exporter.el("export-btn").click();
    await tick();
    await tick();
    const archiveText = await exporter.created[0].text();

    // …import into a store that has one overlapping bucket and one local-only bucket.
    const local = {
      "ga:settings": { openaiApiKey: "sk-LOCAL" },
      "ga:threads:gemini:s1": [thread("t1", 2), thread("local-only")],
      "ga:threads:chatgpt:z2": [thread("mine")],
    };
    const { store } = setup({ initial: local });
    await importText(archiveText);

    expect(store.setCalls).toHaveLength(1);
    const written = store.setCalls[0];
    // Superset: everything local survives, archive threads arrive.
    expect(written["ga:threads:gemini:s1"].map((t) => t.id).sort()).toEqual([
      "local-only",
      "t1",
      "t2",
    ]);
    expect(written["ga:threads:chatgpt:z2"].map((t) => t.id)).toEqual(["mine"]);
    expect(written["ga:threads:claude:s9"].map((t) => t.id)).toEqual(["t3"]);
    expect(written["ga:convo:gemini:conv1"].blobs["h1:5"]).toBe("Zm9vYmFy");
    // Settings key passes through unchanged — never clobbered by an import.
    expect(written["ga:settings"]).toEqual({ openaiApiKey: "sk-LOCAL" });
    expect(status()).toBe("Imported 3 thread(s) into 2 conversation(s) (2 new).");

    // Re-import of the SAME archive: counts stable, storage unchanged (idempotent).
    const snapshot = clone(store.data);
    await importText(archiveText);
    expect(store.setCalls).toHaveLength(2);
    expect(store.data).toEqual(snapshot);
    expect(status()).toBe("Imported 3 thread(s) into 2 conversation(s) (0 new).");
  });

  it("the same input element imports again after a failed pick (input reset before every early return)", async () => {
    const exporter = setup({ initial: SEEDED });
    exporter.el("export-btn").click();
    await tick();
    await tick();
    const archiveText = await exporter.created[0].text();

    const { store, el } = setup();
    await importText("junk {{{"); // first pick fails to parse…
    expect(status()).toContain("isn't valid JSON");
    await importText(archiveText); // …second pick through the SAME input succeeds
    expect(store.setCalls).toHaveLength(1);
    expect(status()).toBe("Imported 3 thread(s) into 2 conversation(s) (3 new).");
    expect(el("import-file").value).toBe("");
  });
});

describe("options import — replace mode", () => {
  const LOCAL = {
    "ga:settings": { scope: "section" },
    "ga:threads:gemini:s1": [thread("a"), thread("b"), thread("c")],
    "ga:threads:other:zz": [thread("untouched")],
  };
  const ARCHIVE = JSON.stringify({
    format: "marginalia-threads",
    version: 1,
    exportedAt: 5,
    threads: { "ga:threads:gemini:s1": [thread("only")] },
    convos: {},
  });

  it("confirm() accepted: replaces only archive-named conversations", async () => {
    const { store, confirms, el } = setup({ initial: LOCAL, confirmResult: true });
    el("import-replace").checked = true;
    await importText(ARCHIVE);

    expect(confirms).toHaveLength(1);
    expect(store.setCalls).toHaveLength(1);
    expect(store.data["ga:threads:gemini:s1"].map((t) => t.id)).toEqual(["only"]);
    expect(store.data["ga:threads:other:zz"].map((t) => t.id)).toEqual(["untouched"]);
    expect(store.data["ga:settings"]).toEqual({ scope: "section" });
  });

  it("confirm() cancelled: no storage read OR write happens, status says cancelled", async () => {
    const { store, confirms, el } = setup({ initial: LOCAL, confirmResult: false });
    el("import-replace").checked = true;
    await importText(ARCHIVE);

    expect(confirms).toHaveLength(1);
    expect(store.setCalls).toHaveLength(0);
    expect(store.getAllCount()).toBe(0); // confirm gates BEFORE any storage access
    expect(store.data).toEqual(LOCAL);
    expect(status()).toBe("Import cancelled — nothing was changed.");
  });

  it("junk file with replace checked: rejected before confirm() is ever shown", async () => {
    const { store, confirms, el } = setup({ initial: LOCAL, confirmResult: true });
    el("import-replace").checked = true;
    await importText(JSON.stringify({ format: "something-else" }));
    expect(confirms).toHaveLength(0);
    expect(store.setCalls).toHaveLength(0);
    expect(status()).toContain("isn't a Marginalia backup");
  });
});

describe("options import — failure paths (F9: every failure is visible)", () => {
  it("malformed (non-JSON) file: error status, storage never touched", async () => {
    const { store } = setup({ initial: SEEDED });
    await importText("this is {{{ not json");
    expect(status()).toBe("Import failed: that file isn't valid JSON. Nothing was changed.");
    expect(store.setCalls).toHaveLength(0);
    expect(store.data).toEqual(SEEDED);
  });

  it("valid JSON but not an archive: error status, storage never touched", async () => {
    const { store } = setup({ initial: SEEDED });
    await importText(JSON.stringify({ hello: "world" }));
    expect(status()).toBe(
      "Import failed: that file isn't a Marginalia backup. Nothing was changed.",
    );
    expect(store.setCalls).toHaveLength(0);
  });

  it("unsupported archive version: mergeImport's throw surfaces in the status line", async () => {
    const { store } = setup({ initial: SEEDED });
    await importText(
      JSON.stringify({ format: "marginalia-threads", version: 2, threads: {}, convos: {} }),
    );
    expect(status()).toBe(
      "Import failed: backup: unsupported archive version 2 Nothing was changed.",
    );
    expect(store.setCalls).toHaveLength(0);
  });

  it("quota-rejected storage.set: quota named in the status, storage unchanged", async () => {
    const { store } = setup({
      initial: SEEDED,
      failSet: "QuotaExceededError: storage.local quota bytes exceeded",
    });
    await importText(
      JSON.stringify({
        format: "marginalia-threads",
        version: 1,
        exportedAt: 1,
        threads: { "ga:threads:new:n1": [thread("n")] },
        convos: {},
      }),
    );
    expect(status()).toBe(
      "Import failed: this browser's extension storage is full (quota exceeded). Nothing was changed.",
    );
    expect(store.setCalls).toHaveLength(1); // it TRIED —
    expect(store.data).toEqual(SEEDED); // — but the atomic set failed; nothing changed
  });

  it("generic rejecting storage.set: failure surfaces with the error message", async () => {
    const { store } = setup({ initial: SEEDED, failSet: "disk exploded" });
    await importText(
      JSON.stringify({
        format: "marginalia-threads",
        version: 1,
        exportedAt: 1,
        threads: { "ga:threads:new:n1": [thread("n")] },
        convos: {},
      }),
    );
    expect(status()).toBe("Import failed: disk exploded Nothing was changed.");
    expect(store.data).toEqual(SEEDED);
  });

  it("crafted archive smuggling ga:settings through the threads map cannot clobber settings, and the status reports 0 accepted", async () => {
    const { store } = setup({ initial: SEEDED });
    await importText(
      JSON.stringify({
        format: "marginalia-threads",
        version: 1,
        exportedAt: 1,
        threads: { "ga:settings": [thread("evil")] },
        convos: {},
      }),
    );
    expect(store.data["ga:settings"]).toEqual(SEEDED["ga:settings"]);
    // The status must count what was ACCEPTED, not what the file claimed.
    expect(status()).toBe("Imported 0 thread(s) into 0 conversation(s) (0 new).");
  });
});

describe("import handler safety (behavioral)", () => {
  const ARCHIVE = JSON.stringify({
    format: "marginalia-threads",
    version: 1,
    exportedAt: 5,
    threads: { "ga:threads:gemini:s1": [thread("only")] },
    convos: {},
  });

  it("merge import lands as ONE atomic set — storage.local.remove/clear never invoked", async () => {
    const { store } = setup({ initial: SEEDED });
    await importText(ARCHIVE);
    expect(store.setCalls).toHaveLength(1);
    expect(store.removeCalls).toEqual([]);
    expect(store.clearCount()).toBe(0);
  });

  it("replace import discards old threads via that same atomic set — never remove/clear", async () => {
    const { store, el } = setup({ initial: SEEDED, confirmResult: true });
    el("import-replace").checked = true;
    await importText(ARCHIVE);
    expect(store.setCalls).toHaveLength(1);
    expect(store.data["ga:threads:gemini:s1"].map((t) => t.id)).toEqual(["only"]); // replaced…
    expect(store.removeCalls).toEqual([]); // …without a destructive call
    expect(store.clearCount()).toBe(0);
  });

  it("export touches storage read-only: no set, no remove, no clear", async () => {
    const { store, el } = setup({ initial: SEEDED });
    el("export-btn").click();
    await tick();
    await tick();
    expect(status()).toMatch(/^Exported /); // the flow actually ran
    expect(store.setCalls).toEqual([]);
    expect(store.removeCalls).toEqual([]);
    expect(store.clearCount()).toBe(0);
  });

  it("attacker-controlled text reaching the status line renders inert as text, never parsed HTML", async () => {
    // A crafted archive's `version` is echoed verbatim into the failure status.
    const evil = '<img src=x onerror="document.body.dataset.pwned=1"> "quoted"';
    const first = setup({ initial: SEEDED });
    await importText(
      JSON.stringify({ format: "marginalia-threads", version: evil, threads: {}, convos: {} }),
    );
    let statusEl = first.el("backup-status");
    expect(statusEl.textContent).toBe(
      "Import failed: backup: unsupported archive version " + evil + " Nothing was changed.",
    );
    expect(statusEl.children).toHaveLength(0); // textContent, not markup
    expect(document.querySelector("img")).toBeNull();
    expect(document.body.dataset.pwned).toBeUndefined();

    // A storage-failure message surfacing on the import path is likewise inert.
    const second = setup({ initial: SEEDED, failSet: "broken <b>tag</b> storage" });
    await importText(ARCHIVE);
    statusEl = second.el("backup-status");
    expect(statusEl.textContent).toBe(
      "Import failed: broken <b>tag</b> storage Nothing was changed.",
    );
    expect(statusEl.children).toHaveLength(0);
    expect(document.querySelector("b")).toBeNull();
  });
});
