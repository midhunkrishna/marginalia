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
}

async function save() {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
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

const PROVIDER_ROWS = {
  openai: { keyField: "openaiApiKey", modelField: "openaiModel" },
  gemini: { keyField: "geminiApiKey", modelField: "geminiModel" },
  anthropic: { keyField: "anthropicApiKey", modelField: "anthropicModel" },
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
    opt.textContent = m.id;
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
    return "✗ HTTP " + s + " — key rejected. Check for extra spaces or an expired key.";
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

// B7 trust story: the single-source line is appended to the API-keys hint so
// wording changes live in exactly one place (shared/settings-schema.js).
const keysHint = document.getElementById("keys-hint");
if (keysHint && GA.schema.TRUST_LINE) {
  const line = document.createElement("b");
  line.textContent = GA.schema.TRUST_LINE;
  keysHint.appendChild(document.createTextNode(" "));
  keysHint.appendChild(line);
}

load();
