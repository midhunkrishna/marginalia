// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";
import { makeStorageFake } from "../helpers/storage-mock.js";

// Options-page Quick actions card (issue #10): list the chips, edit / add /
// remove / reorder them, reset to defaults — all persisted through the normal
// settings save. Drives the REAL options.html markup + options.js.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HTML = fs.readFileSync(path.join(ROOT, "src/options/options.html"), "utf8");
const MAIN = HTML.slice(HTML.indexOf("<main"), HTML.indexOf("</main>") + "</main>".length);

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  await tick();
  await tick();
  await tick();
};
const DEBOUNCE = () => new Promise((r) => setTimeout(r, 450));

async function setup(initial = {}) {
  document.body.innerHTML = MAIN;
  const store = makeStorageFake({ initial, runtime: { sendMessage: () => Promise.resolve({}) } });
  const GA = loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/protocol.js",
      "src/shared/copy.js",
      "src/core/backup.js",
      "src/core/quick-actions.js",
      "src/options/options.js",
    ],
    { browser: store.browser },
  );
  await settle();
  const el = (id) => document.getElementById(id);
  const rows = () => [...document.querySelectorAll("#qa-list .qa-item")];
  const labels = () => rows().map((r) => r.querySelector('[data-field="label"]').value);
  const saved = () => (store.data["ga:settings"] || {}).quickActions;
  const savedLabels = () => (saved() || []).map((a) => a.label);
  const btn = (row, name) => row.querySelector(`button[aria-label^="${name}"]`);
  return { GA, el, rows, labels, saved, savedLabels, btn };
}

function typeInto(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Quick actions card", () => {
  it("lists the four default chips when nothing is stored", async () => {
    const { labels, rows } = await setup();
    expect(labels()).toEqual(["Explain", "ELI5", "Sources?", "Counter-argument"]);
    expect(rows()[0].querySelector('[data-field="prompt"]').value).toMatch(/Explain/);
  });

  it("lists stored chips instead, sanitizing junk", async () => {
    const { labels } = await setup({
      "ga:settings": {
        quickActions: [{ id: "x", label: "Mine", prompt: "p" }, { label: "", prompt: "p" }, null],
      },
    });
    expect(labels()).toEqual(["Mine"]);
  });

  it("editing a name or prompt persists (debounced)", async () => {
    const { rows, saved } = await setup();
    typeInto(rows()[1].querySelector('[data-field="label"]'), "Simple");
    typeInto(rows()[1].querySelector('[data-field="prompt"]'), "Keep it simple.");
    await DEBOUNCE();
    expect(saved()[1]).toMatchObject({ id: "eli5", label: "Simple", prompt: "Keep it simple." });
    expect(document.getElementById("qa-status").textContent).toBe("Saved.");
  });

  it("Add chip appends a focused blank row that is stored only once filled", async () => {
    const { el, rows, saved } = await setup();
    el("qa-add").click();
    await settle();
    expect(rows()).toHaveLength(5);
    const last = rows()[4];
    expect(document.activeElement).toBe(last.querySelector('[data-field="label"]'));
    expect(saved()).toBeUndefined(); // nothing saved by merely adding a blank row
    typeInto(last.querySelector('[data-field="label"]'), "Jargon");
    typeInto(
      last.querySelector('[data-field="prompt"]'),
      "Define every technical term as a table.",
    );
    await DEBOUNCE();
    expect(saved()).toHaveLength(5);
    expect(saved()[4]).toMatchObject({ label: "Jargon" });
  });

  it("a blank row never reaches storage even if another change saves", async () => {
    const { el, rows, saved, btn } = await setup();
    el("qa-add").click();
    await settle();
    btn(rows()[0], "Move Explain down").click();
    await settle();
    expect(saved()).toHaveLength(4);
  });

  it("move up/down reorders and persists; edges are disabled", async () => {
    const { rows, labels, savedLabels, btn } = await setup();
    expect(btn(rows()[0], "Move Explain up").disabled).toBe(true);
    expect(btn(rows()[3], "Move Counter-argument down").disabled).toBe(true);
    btn(rows()[0], "Move Explain down").click();
    await settle();
    expect(labels()).toEqual(["ELI5", "Explain", "Sources?", "Counter-argument"]);
    expect(savedLabels()).toEqual(["ELI5", "Explain", "Sources?", "Counter-argument"]);
    btn(rows()[3], "Move Counter-argument up").click();
    await settle();
    expect(savedLabels()).toEqual(["ELI5", "Explain", "Counter-argument", "Sources?"]);
  });

  it("remove drops a chip and persists, including down to none", async () => {
    const { rows, labels, savedLabels, btn } = await setup();
    btn(rows()[1], "Remove ELI5").click();
    await settle();
    expect(labels()).toEqual(["Explain", "Sources?", "Counter-argument"]);
    expect(savedLabels()).toEqual(["Explain", "Sources?", "Counter-argument"]);
    for (let n = 0; n < 3; n++) {
      rows()[0].querySelector('button[aria-label^="Remove"]').click();
      await settle();
    }
    expect(rows()).toHaveLength(0);
    expect(savedLabels()).toEqual([]);
  });

  it("Reset to defaults restores the shipped chips and persists them", async () => {
    const { el, rows, labels, savedLabels, btn } = await setup();
    btn(rows()[0], "Remove Explain").click();
    await settle();
    expect(labels()).toHaveLength(3);
    el("qa-reset").click();
    await settle();
    expect(labels()).toEqual(["Explain", "ELI5", "Sources?", "Counter-argument"]);
    expect(savedLabels()).toEqual(["Explain", "ELI5", "Sources?", "Counter-argument"]);
    expect(el("qa-status").textContent).toBe("Reset to defaults.");
  });

  it("Add is disabled once the chip cap is reached", async () => {
    const { GA, el } = await setup();
    const max = GA.core.quickActions.MAX_ACTIONS;
    for (let n = 4; n < max; n++) el("qa-add").click();
    expect(el("qa-add").disabled).toBe(true);
  });
});
