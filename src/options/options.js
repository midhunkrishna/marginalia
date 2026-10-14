// options.js — settings page (runs as an extension page, not a content script).
// Schema comes from shared/settings-schema.js (loaded just before this file).
const SETTINGS_KEY = GA.schema.SETTINGS_KEY;
const DEFAULTS = GA.schema.DEFAULT_SETTINGS;
const THREADS_PREFIX = GA.schema.THREADS_PREFIX;

const els = {
  shortcutBtn: document.getElementById("shortcut-btn"),
  shortcutReset: document.getElementById("shortcut-reset"),
  shortcutStatus: document.getElementById("shortcut-status"),
  clearBtn: document.getElementById("clear-btn"),
  clearStatus: document.getElementById("clear-status"),
  exportBtn: document.getElementById("export-btn"),
  importBtn: document.getElementById("import-btn"),
  importFile: document.getElementById("import-file"),
  importReplace: document.getElementById("import-replace"),
  backupStatus: document.getElementById("backup-status"),
  adder: document.getElementById("adder"),
  calmScroll: document.getElementById("calm-scroll"),
  debug: document.getElementById("debug"),
  apikeysStatus: document.getElementById("apikeys-status"),
};

// settings field <-> input id, for the optional API-key backends
const API_FIELDS = {
  openaiApiKey: "openai-key",
  openaiModel: "openai-model",
  geminiApiKey: "gemini-key",
  geminiModel: "gemini-model",
  anthropicApiKey: "anthropic-key",
  anthropicModel: "anthropic-model",
  openrouterApiKey: "openrouter-key",
  openrouterModel: "openrouter-model",
};

let settings = Object.assign({}, DEFAULTS);
let recording = false;

function fmtShortcut(sc) {
  const parts = [];
  if (sc.ctrl) parts.push("Ctrl");
  if (sc.alt) parts.push("Alt");
  if (sc.shift) parts.push("Shift");
  if (sc.meta) parts.push("Cmd");
  parts.push((sc.key || "").toUpperCase());
  return parts.join(" + ");
}

async function load() {
  const obj = await browser.storage.local.get(SETTINGS_KEY);
  const stored = obj[SETTINGS_KEY] || {};
  settings = Object.assign({}, DEFAULTS, stored, {
    shortcut: Object.assign({}, DEFAULTS.shortcut, stored.shortcut || {}),
    quickActions: GA.core.quickActions.sanitizeQuickActions(stored.quickActions),
  });
  render();
}

function render() {
  els.shortcutBtn.textContent = fmtShortcut(settings.shortcut);
  document.querySelectorAll('input[name="scope"]').forEach((r) => {
    r.checked = r.value === settings.scope;
  });
  els.adder.checked = settings.adder !== false;
  els.calmScroll.checked = !!settings.calmScroll;
  els.debug.checked = !!settings.debug;
  Object.keys(API_FIELDS).forEach((field) => {
    const input = document.getElementById(API_FIELDS[field]);
    if (input) input.value = settings[field] == null ? "" : settings[field];
  });
  renderResearch();
  renderQuickActions();
}

// Persist settings; the quick-action list is sanitized on the way out so a
// half-typed blank chip never reaches storage.
async function save() {
  const out = Object.assign({}, settings, {
    quickActions: GA.core.quickActions.sanitizeQuickActions(settings.quickActions),
  });
  await browser.storage.local.set({ [SETTINGS_KEY]: out });
}

// shortcut capture
els.shortcutBtn.addEventListener("click", () => {
  recording = true;
  els.shortcutBtn.classList.add("recording");
  els.shortcutBtn.textContent = "Press keys…";
  els.shortcutStatus.textContent = "";
});

window.addEventListener("keydown", async (e) => {
  if (!recording) return;
  e.preventDefault();
  const key = e.key.toLowerCase();
  if (["control", "shift", "alt", "meta"].includes(key)) return; // wait for a real key
  settings.shortcut = {
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
    key,
  };
  recording = false;
  els.shortcutBtn.classList.remove("recording");
  render();
  await save();
  els.shortcutStatus.textContent = "Saved.";
});

els.shortcutReset.addEventListener("click", async () => {
  settings.shortcut = Object.assign({}, DEFAULTS.shortcut);
  render();
  await save();
  els.shortcutStatus.textContent = "Reset to default.";
});

document.querySelectorAll('input[name="scope"]').forEach((r) => {
  r.addEventListener("change", async () => {
    if (r.checked) {
      settings.scope = r.value;
      await save();
    }
  });
});

els.adder.addEventListener("change", async () => {
  settings.adder = els.adder.checked;
  await save();
});

els.calmScroll.addEventListener("change", async () => {
  settings.calmScroll = els.calmScroll.checked;
  await save();
});

els.debug.addEventListener("change", async () => {
  settings.debug = els.debug.checked;
  await save();
});

// API keys + models — save on input (debounced so we don't write on every keystroke)
let apikeysTimer = 0;
Object.keys(API_FIELDS).forEach((field) => {
  const input = document.getElementById(API_FIELDS[field]);
  if (!input) return;
  input.addEventListener("input", () => {
    settings[field] = input.value.trim();
    clearTimeout(apikeysTimer);
    apikeysTimer = setTimeout(async () => {
      await save();
      els.apikeysStatus.textContent = "Saved.";
    }, 400);
  });
});

// ---- API-key Test button + live model dropdown (issue #2) ----
// Network runs in the background (MSG_TEST_KEY / MSG_LIST_MODELS, key-test.js);
// this side owns the per-row state machine (idle → testing → ok | failed) and
// the user-facing phrasing. Tests are strictly user-initiated — nothing here
// fires on load or input. Saving never depends on any of it.

const OTHER_VALUE = "__other__";

// providerId = the registry id stamped on messages (sites.RESEARCH_ROWS).
const PROVIDER_ROWS = {
  openai: { keyField: "openaiApiKey", modelField: "openaiModel", providerId: "chatgpt" },
  gemini: { keyField: "geminiApiKey", modelField: "geminiModel", providerId: "gemini" },
  anthropic: { keyField: "anthropicApiKey", modelField: "anthropicModel", providerId: "claude" },
  openrouter: {
    keyField: "openrouterApiKey",
    modelField: "openrouterModel",
    providerId: "openrouter",
  },
};

// Model lists cached for this options-page session only, and only while the
// key they were fetched with is still the one in the input.
const modelCache = {};

function rowEls(provider) {
  return {
    key: document.getElementById(provider + "-key"),
    model: document.getElementById(provider + "-model"),
    select: document.getElementById(provider + "-model-select"),
    test: document.getElementById(provider + "-test"),
    status: document.getElementById(provider + "-test-status"),
    research: document.getElementById(provider + "-research"),
  };
}

function setRowStatus(el, text, kind) {
  el.textContent = text;
  el.classList.toggle("ok", kind === "ok");
  el.classList.toggle("bad", kind === "bad");
}

// The model the Test button should exercise: the dropdown choice when one is
// active, else the free-text input, else the schema default.
function currentModel(provider) {
  const row = rowEls(provider);
  if (row.select && !row.select.hidden && row.select.value && row.select.value !== OTHER_VALUE) {
    return row.select.value;
  }
  const typed = row.model ? row.model.value.trim() : "";
  return typed || DEFAULTS[PROVIDER_ROWS[provider].modelField];
}

// "gpt4o-mini" -> "gpt-4o-mini": exact match after lowercasing and stripping
// non-alphanumerics. Covers punctuation/casing typos without an edit-distance
// dependency; null means "no suggestion".
function suggestModel(typed, models) {
  const norm = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const target = norm(typed);
  if (!target) return null;
  const hit = (models || []).find((m) => norm(m.id) === target);
  return hit ? hit.id : null;
}

// sendMessage can itself reject (e.g. worker spin-up hiccup) — degrade to the
// same shape the background would return for a transport failure.
async function sendBg(msg) {
  try {
    const res = await browser.runtime.sendMessage(msg);
    return res || { ok: false, status: 0, detail: "", message: "Network error." };
  } catch (e) {
    return { ok: false, status: 0, detail: "", message: "Network error." };
  }
}

// Fetch (or reuse) the provider's model list. Returns models or null; a null
// never blocks anything — the free-text input stays authoritative.
async function fetchModels(provider, key) {
  const cached = modelCache[provider];
  if (cached && cached.key === key) return cached.models;
  const res = await sendBg({ type: GA.protocol.MSG_LIST_MODELS, provider, key });
  if (!res.ok || !Array.isArray(res.models) || !res.models.length) return null;
  modelCache[provider] = { key, models: res.models };
  return res.models;
}

// Swap the free-text input for a <select> of live model ids, keeping "Other…"
// as the escape hatch (vendors rename ids; the API may lag reality).
function populateSelect(provider, models) {
  const row = rowEls(provider);
  if (!row.select || !row.model) return;
  const field = PROVIDER_ROWS[provider].modelField;
  const current = settings[field] || "";
  row.select.textContent = "";
  models.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    // OpenRouter flags models without function calling; research needs it.
    opt.textContent = m.tools === false ? m.id + " (no tools)" : m.id;
    row.select.appendChild(opt);
  });
  const other = document.createElement("option");
  other.value = OTHER_VALUE;
  other.textContent = "Other…";
  row.select.appendChild(other);
  const listed = models.some((m) => m.id === current);
  row.select.value = listed ? current : OTHER_VALUE;
  row.select.hidden = false;
  row.model.hidden = listed;
  // Keep the (hidden) free-text input in step with the active model, so
  // "Other…" always reveals the id actually in use, never a stale one.
  if (listed) row.model.value = current;
}

// Compose the ✗ line from the background's structured {status, detail}.
function failureText(provider, model, res, suggestion) {
  const detail = (res.detail || "").slice(0, 120);
  const s = res.status;
  // Google reports a bad key as HTTP 400 ("API key not valid"), not 401.
  const keyRejected =
    s === 401 || s === 403 || (provider === "gemini" && s === 400 && /api key/i.test(detail));
  if (keyRejected) {
    // The trust line rides along here only — the moment a user doubts where a key went.
    return (
      "✗ HTTP " +
      s +
      " — key rejected. Check for extra spaces or an expired key. " +
      GA.copy.TRUST_LINE
    );
  }
  if (s === 404) {
    let text = '✗ HTTP 404 — model "' + model + '" not found.';
    if (suggestion) text += ' Did you mean "' + suggestion + '"?';
    else if (detail) text += " " + detail;
    return text;
  }
  if (s === 0) return "✗ " + (res.message || "Network error.");
  return "✗ HTTP " + s + " — " + (detail || "request failed.");
}

async function onTest(provider) {
  const row = rowEls(provider);
  const key = row.key.value.trim();
  if (!key) {
    setRowStatus(row.status, "Enter an API key first.", "bad");
    return;
  }
  const model = currentModel(provider);
  // The key input stays editable while a test is in flight; a verdict earned
  // by the key snapshotted at click time must never be attributed to a key the
  // user typed afterwards. Checked after every await.
  const keyChanged = () => {
    if (row.key.value.trim() === key) return false;
    setRowStatus(row.status, "Key changed while testing — click Test again.", "");
    return true;
  };
  row.test.disabled = true;
  setRowStatus(row.status, "Testing…", "");
  try {
    const res = await sendBg({ type: GA.protocol.MSG_TEST_KEY, provider, key, model });
    if (keyChanged()) return;
    if (res.ok) {
      setRowStatus(row.status, "✓ Key OK — " + model + " reachable (" + res.ms + " ms)", "ok");
      const models = await fetchModels(provider, key);
      if (keyChanged()) return;
      if (models) populateSelect(provider, models);
      else {
        row.status.textContent += " — model list unavailable, type a model id.";
      }
      return;
    }
    // A 404 proves the key was accepted — fetch the list anyway: the dropdown
    // (and a did-you-mean) is exactly the fix the user needs.
    let suggestion = null;
    if (res.status === 404) {
      const models = await fetchModels(provider, key);
      if (keyChanged()) return;
      if (models) {
        populateSelect(provider, models);
        suggestion = suggestModel(model, models);
      }
    }
    setRowStatus(row.status, failureText(provider, model, res, suggestion), "bad");
  } finally {
    row.test.disabled = false;
  }
}

Object.keys(PROVIDER_ROWS).forEach((provider) => {
  const row = rowEls(provider);
  if (!row.key || !row.model || !row.select || !row.test || !row.status) return;
  row.test.addEventListener("click", () => onTest(provider));
  row.select.addEventListener("change", async () => {
    if (row.select.value === OTHER_VALUE) {
      row.model.hidden = false;
      row.model.focus();
      return; // the input's existing debounced handler owns saving from here
    }
    row.model.hidden = true;
    // Mirror the pick into the free-text input so a later switch to "Other…"
    // starts from the model actually in use.
    row.model.value = row.select.value;
    settings[PROVIDER_ROWS[provider].modelField] = row.select.value;
    await save();
    els.apikeysStatus.textContent = "Saved.";
  });
});

// ---- Research mode ----
// researchProvider is one options-row id (or ""), exclusive across rows and
// only offered for rows that have a key. The page-read toggle is permission
// state (optional <all_urls>), never a setting.

const READ_ORIGINS = { origins: ["<all_urls>"] };

// Clamp ranges mirror GA.core.research.clampLimits (not loaded on this page).
const LIMIT_FIELDS = {
  researchMaxSteps: { id: "research-max-steps", min: 2, max: 15 },
  researchMaxSearches: { id: "research-max-searches", min: 0, max: 10 },
  researchMaxPages: { id: "research-max-pages", min: 0, max: 8 },
};

const researchEls = {
  searchProvider: document.getElementById("search-provider"),
  searchKey: document.getElementById("search-key"),
  searchTest: document.getElementById("search-test"),
  searchStatus: document.getElementById("search-test-status"),
  readPages: document.getElementById("research-read-pages"),
  readBlock: document.getElementById("read-pages-block"),
  status: document.getElementById("research-status"),
};

function clampLimit(field, raw) {
  const spec = LIMIT_FIELDS[field];
  const n = Math.round(Number(raw));
  if (raw === "" || raw == null || !Number.isFinite(n)) return DEFAULTS[field];
  return Math.min(spec.max, Math.max(spec.min, n));
}

function syncResearchBoxes() {
  Object.keys(PROVIDER_ROWS).forEach((row) => {
    const r = rowEls(row);
    if (!r.research) return;
    const hasKey = !!(r.key && r.key.value.trim());
    r.research.disabled = !hasKey;
    r.research.checked = hasKey && settings.researchProvider === row;
  });
}

function syncSearchKey() {
  if (!researchEls.searchProvider || !researchEls.searchKey) return;
  const brave = researchEls.searchProvider.value === "brave";
  researchEls.searchKey.hidden = !brave;
  researchEls.searchKey.disabled = !brave;
  const help = document.getElementById(BRAVE_HELP_ID);
  if (help) help.hidden = !brave;
}

function renderResearch() {
  syncResearchBoxes();
  if (researchEls.searchProvider) {
    researchEls.searchProvider.value = settings.searchProvider === "brave" ? "brave" : "ddg";
  }
  if (researchEls.searchKey) researchEls.searchKey.value = settings.searchApiKey || "";
  syncSearchKey();
  Object.keys(LIMIT_FIELDS).forEach((field) => {
    const input = document.getElementById(LIMIT_FIELDS[field].id);
    if (input) input.value = String(clampLimit(field, settings[field]));
  });
}

async function saveResearch() {
  await save();
  if (researchEls.status) researchEls.status.textContent = "Saved.";
}

Object.keys(PROVIDER_ROWS).forEach((row) => {
  const r = rowEls(row);
  if (!r.research || !r.key) return;
  r.research.addEventListener("change", async () => {
    settings.researchProvider = r.research.checked ? row : "";
    syncResearchBoxes();
    await save();
    els.apikeysStatus.textContent = "Saved.";
  });
  // Live enable/disable; the key's own debounced handler (registered above,
  // so it runs first) owns the save that carries a reset researchProvider.
  r.key.addEventListener("input", () => {
    if (!r.key.value.trim() && settings.researchProvider === row) {
      settings.researchProvider = "";
    }
    syncResearchBoxes();
  });
});

if (researchEls.searchProvider) {
  researchEls.searchProvider.addEventListener("change", async () => {
    settings.searchProvider = researchEls.searchProvider.value;
    syncSearchKey();
    setRowStatus(researchEls.searchStatus, "", "");
    await saveResearch();
  });
}

let searchKeyTimer = 0;
if (researchEls.searchKey) {
  researchEls.searchKey.addEventListener("input", () => {
    settings.searchApiKey = researchEls.searchKey.value.trim();
    clearTimeout(searchKeyTimer);
    searchKeyTimer = setTimeout(saveResearch, 400);
  });
}

if (researchEls.searchTest && researchEls.searchStatus && researchEls.searchProvider) {
  researchEls.searchTest.addEventListener("click", async () => {
    const provider = researchEls.searchProvider.value;
    const key = provider === "brave" ? researchEls.searchKey.value.trim() : "";
    if (provider === "brave" && !key) {
      setRowStatus(researchEls.searchStatus, "Enter a Brave API key first.", "bad");
      return;
    }
    researchEls.searchTest.disabled = true;
    setRowStatus(researchEls.searchStatus, "Testing…", "");
    try {
      const res = await sendBg({ type: GA.protocol.MSG_TEST_SEARCH, provider, key });
      if (res.ok) {
        const text = "OK · " + res.count + " results · " + res.ms + "ms";
        setRowStatus(researchEls.searchStatus, text, "ok");
      } else {
        setRowStatus(researchEls.searchStatus, res.message || "Search failed.", "bad");
      }
    } finally {
      researchEls.searchTest.disabled = false;
    }
  });
}

Object.keys(LIMIT_FIELDS).forEach((field) => {
  const input = document.getElementById(LIMIT_FIELDS[field].id);
  if (!input) return;
  input.addEventListener("change", async () => {
    settings[field] = clampLimit(field, input.value);
    input.value = String(settings[field]);
    await saveResearch();
  });
});

// permissions.request must run inside the click's user gesture, so it is the
// first call in the click handler (by then `checked` holds the new state). Firefox and Chrome both expose the promise API
// through the polyfill; a missing API (old build, test harness) hides it.
const perms = typeof browser !== "undefined" && browser.permissions;
if (researchEls.readPages) {
  if (!perms || typeof perms.request !== "function") {
    researchEls.readPages.disabled = true;
    if (researchEls.readBlock) researchEls.readBlock.hidden = true;
  } else {
    researchEls.readPages.addEventListener("click", async () => {
      const box = researchEls.readPages;
      try {
        if (box.checked) box.checked = !!(await perms.request(READ_ORIGINS));
        else box.checked = !(await perms.remove(READ_ORIGINS));
      } catch (e) {
        box.checked = !!(await perms.contains(READ_ORIGINS).catch(() => false));
      }
    });
    Promise.resolve()
      .then(() => perms.contains(READ_ORIGINS))
      .then((has) => {
        researchEls.readPages.checked = !!has;
      })
      .catch(() => {});
  }
}

// ---- Key help: "Get a key" + "Pricing" links (issue #17) ----
// Links only — never prices, which go stale. The URLs live in GA.copy.PROVIDER_LINKS
// (shared/copy.js), keyed by provider id; a test fails when a provider lacks an entry.

const BRAVE_HELP_ID = "brave-keyhelp";

// An external link that opens in a new tab without handing over window.opener.
function externalLink(text, href) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

// The help line for one PROVIDER_LINKS entry: "Get a key ↗ · Pricing ↗ [· note]".
function buildKeyHelp(links) {
  const p = document.createElement("p");
  p.className = "hint key-help";
  const sep = () => {
    const s = document.createElement("span");
    s.className = "sep";
    s.textContent = "·";
    return s;
  };
  p.append(externalLink("Get a key ↗", links.keyUrl), sep());
  p.append(externalLink("Pricing ↗", links.pricingUrl));
  if (links.note) p.append(sep(), links.note);
  return p;
}

// Add the help line for one options row (an id from PROVIDER_ROWS, or "brave"
// for the Research card's search key). Rows go right before their key input;
// Brave's goes under the search row and shows only while Brave is selected.
// A page without the row's elements is left alone.
function renderKeyHelp(provider) {
  const isBrave = provider === "brave";
  const linksId = isBrave ? "brave" : PROVIDER_ROWS[provider].providerId;
  const links = GA.copy.PROVIDER_LINKS[linksId];
  const input = isBrave ? researchEls.searchKey : rowEls(provider).key;
  if (!links || !input) return;
  const help = buildKeyHelp(links);
  if (isBrave) {
    help.id = BRAVE_HELP_ID;
    help.hidden = !(researchEls.searchProvider && researchEls.searchProvider.value === "brave");
    input.parentElement.after(help);
  } else {
    input.before(help);
  }
}

[...Object.keys(PROVIDER_ROWS), "brave"].forEach(renderKeyHelp);

// The trust line atop the API-keys card comes from the shared copy, not the markup.
GA.copy.fillTrustLines(document);

// ---- Quick actions editor (issue #10) ----
// The chips shown above the composer of a new thread. `settings.quickActions`
// is the live working list (it may hold a half-typed blank row); every save
// goes through sanitize (see save()) so storage only ever gets valid chips.
// Structural edits (add / remove / move / reset) save at once and re-render;
// typing saves debounced and never re-renders (focus must survive).

const QA = GA.core.quickActions;
const qaEls = {
  list: document.getElementById("qa-list"),
  add: document.getElementById("qa-add"),
  reset: document.getElementById("qa-reset"),
  status: document.getElementById("qa-status"),
};
let qaTimer = 0;
let qaSeq = 0;

// Short status line under the card.
function setQaStatus(text) {
  if (qaEls.status) qaEls.status.textContent = text;
}

// Persist the working list now and say so.
async function saveQuickActions(message) {
  clearTimeout(qaTimer);
  await save();
  setQaStatus(message);
}

// Persist after the user pauses typing (like the API-key inputs).
function saveQuickActionsSoon() {
  clearTimeout(qaTimer);
  qaTimer = setTimeout(() => saveQuickActions("Saved."), 400);
}

// One <input>/<textarea> bound to a field of chip `action`.
function qaField(tag, action, field, placeholder, label) {
  const input = document.createElement(tag);
  input.value = action[field];
  input.placeholder = placeholder;
  input.setAttribute("aria-label", label);
  input.dataset.field = field;
  if (tag === "input") input.maxLength = QA.MAX_LABEL;
  else input.rows = 2;
  input.addEventListener("input", () => {
    action[field] = input.value;
    saveQuickActionsSoon();
  });
  return input;
}

// A small icon-ish button for a chip row (aria-labelled for screen readers).
function qaButton(text, label, disabled, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ghost";
  b.textContent = text;
  b.title = label;
  b.setAttribute("aria-label", label);
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

// The whole row for chip number `i`: label, prompt, and up / down / remove.
function qaRow(action, i, count) {
  const name = action.label || "chip " + (i + 1);
  const li = document.createElement("li");
  li.className = "qa-item";
  const btns = document.createElement("div");
  btns.className = "qa-btns";
  btns.append(
    qaButton("↑", "Move " + name + " up", i === 0, () => moveQuickAction(i, -1)),
    qaButton("↓", "Move " + name + " down", i === count - 1, () => moveQuickAction(i, 1)),
    qaButton("✕", "Remove " + name, false, () => removeQuickAction(i)),
  );
  li.append(
    qaField("input", action, "label", "Name", "Chip name"),
    qaField("textarea", action, "prompt", "Prompt sent when tapped", "Chip prompt"),
    btns,
  );
  return li;
}

// Rebuild the list from settings.quickActions (and the Add button's cap).
function renderQuickActions() {
  if (!qaEls.list) return;
  const list = settings.quickActions;
  qaEls.list.textContent = "";
  list.forEach((a, i) => qaEls.list.appendChild(qaRow(a, i, list.length)));
  if (qaEls.add) qaEls.add.disabled = list.length >= QA.MAX_ACTIONS;
}

// Swap chip `i` with its neighbour (`dir` = -1 up, +1 down).
async function moveQuickAction(i, dir) {
  const list = settings.quickActions;
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  renderQuickActions();
  await saveQuickActions("Saved.");
}

// Drop chip `i`.
async function removeQuickAction(i) {
  settings.quickActions.splice(i, 1);
  renderQuickActions();
  await saveQuickActions("Removed.");
}

// Append a blank chip and put the caret in its name field. Blank chips are
// not stored until both fields have text (sanitize drops them).
function addQuickAction() {
  if (settings.quickActions.length >= QA.MAX_ACTIONS) return;
  settings.quickActions.push({ id: "qa-new-" + Date.now() + "-" + qaSeq++, label: "", prompt: "" });
  renderQuickActions();
  const rows = qaEls.list.querySelectorAll(".qa-item");
  rows[rows.length - 1].querySelector('[data-field="label"]').focus();
  setQaStatus("Fill in a name and a prompt to save it.");
}

// Restore the shipped chips.
async function resetQuickActions() {
  settings.quickActions = QA.defaults();
  renderQuickActions();
  await saveQuickActions("Reset to defaults.");
}

if (qaEls.add) qaEls.add.addEventListener("click", addQuickAction);
if (qaEls.reset) qaEls.reset.addEventListener("click", resetQuickActions);

// ---- Backup: export / import (GA.core.backup, loaded just before this file) ----

// Count thread records (N) and conversation buckets (M) in a threads map
// ({ "ga:threads:<id>": [thread, …] }), e.g. an archive envelope's `threads`.
// Only buckets the import engine would actually ACCEPT (correctly prefixed,
// array-shaped) are counted, so the status line never claims rejected data.
function threadCounts(threadsObj) {
  const src = threadsObj && typeof threadsObj === "object" ? threadsObj : {};
  const buckets = Object.keys(src).filter(
    (k) => k.indexOf(THREADS_PREFIX) === 0 && Array.isArray(src[k]),
  );
  let records = 0;
  buckets.forEach((k) => {
    records += src[k].length;
  });
  return { records, buckets: buckets.length };
}

// Total thread records currently in a full storage object (allowlisted by prefix).
function storedThreadCount(all) {
  let n = 0;
  Object.keys(all || {}).forEach((k) => {
    if (k.indexOf(THREADS_PREFIX) === 0 && Array.isArray(all[k])) n += all[k].length;
  });
  return n;
}

function ymdStamp(d) {
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// Download `text` as a JSON file via a temporary anchor; always revokes the URL.
function downloadJson(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Deferred: revoking in the same task as click() can intermittently abort
    // the download in Firefox before it dereferences the blob URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

els.exportBtn.addEventListener("click", async () => {
  try {
    const all = await browser.storage.local.get();
    const env = GA.core.backup.buildExport(all, Date.now());
    const { records, buckets } = threadCounts(env.threads);
    downloadJson(
      JSON.stringify(env, null, 2),
      `marginalia-threads-${ymdStamp(new Date(env.exportedAt))}.json`,
    );
    els.backupStatus.textContent = `Exported ${records} thread(s) from ${buckets} conversation(s).`;
  } catch (err) {
    els.backupStatus.textContent = "Export failed: " + ((err && err.message) || String(err));
  }
});

els.importBtn.addEventListener("click", () => {
  els.importFile.click();
});

els.importFile.addEventListener("change", async () => {
  const file = els.importFile.files && els.importFile.files[0];
  // Reset immediately so choosing the same file again re-fires "change".
  // (The File reference stays readable after the input is cleared.)
  els.importFile.value = "";
  if (!file) return;
  try {
    // Read outside the parse-guard so a file READ error (file moved/changed
    // since it was picked) reports as itself, not as invalid JSON.
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      els.backupStatus.textContent =
        "Import failed: that file isn't valid JSON. Nothing was changed.";
      return;
    }
    if (!parsed || parsed.format !== GA.core.backup.FORMAT) {
      els.backupStatus.textContent =
        "Import failed: that file isn't a Marginalia backup. Nothing was changed.";
      return;
    }
    const replace = els.importReplace.checked;
    if (replace) {
      // The one destructive path: confirm BEFORE any storage access.
      const ok = confirm(
        "Replace instead of merge: your current threads for every conversation in " +
          "this backup will be discarded and replaced by the backup's. Continue?",
      );
      if (!ok) {
        els.backupStatus.textContent = "Import cancelled — nothing was changed.";
        return;
      }
    }
    const existing = await browser.storage.local.get();
    const before = storedThreadCount(existing);
    const next = GA.core.backup.mergeImport(existing, parsed, {
      mode: replace ? "replace" : "merge",
    });
    await browser.storage.local.set(next);
    const { records, buckets } = threadCounts(parsed.threads);
    const gained = Math.max(0, storedThreadCount(next) - before);
    els.backupStatus.textContent = `Imported ${records} thread(s) into ${buckets} conversation(s) (${gained} new).`;
  } catch (err) {
    const msg = (err && err.message) || String(err);
    els.backupStatus.textContent = /quota/i.test(msg)
      ? "Import failed: this browser's extension storage is full (quota exceeded). Nothing was changed."
      : "Import failed: " + msg + " Nothing was changed.";
  }
});

els.clearBtn.addEventListener("click", async () => {
  const all = await browser.storage.local.get();
  const keys = Object.keys(all).filter((k) => k.indexOf(THREADS_PREFIX) === 0);
  if (keys.length) await browser.storage.local.remove(keys);
  els.clearStatus.textContent = keys.length
    ? `Deleted threads from ${keys.length} conversation(s).`
    : "No saved threads.";
});

load();
