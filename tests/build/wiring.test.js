import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The background modules load in two hand-maintained places: Firefox's
// manifest.json `background.scripts` array and Chrome's sw.js importScripts()
// call. They must list the same files in the same order (load order matters —
// e.g. shared/sse.js and the api-client-factory must precede the clients that
// use them). This test fails if they drift.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const fxScripts = manifest.background.scripts;

// Strip line comments first so the `importScripts()` mentioned in sw.js's header
// comment doesn't match ahead of the real call.
const sw = read("src/sw.js").replace(/\/\/.*$/gm, "");
const importBlock = sw.match(/importScripts\(([\s\S]*?)\)/);
const swScripts = importBlock
  ? [...importBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/^\//, ""))
  : [];

describe("background wiring stays in sync across Firefox + Chrome", () => {
  it("manifest.json background.scripts matches sw.js importScripts (order + set)", () => {
    expect(swScripts).toEqual(fxScripts);
  });

  it("every listed background script exists on disk", () => {
    for (const rel of fxScripts) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel + " should exist").toBe(true);
    }
  });

  it("chrome manifest points at the sw.js service worker", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    expect(chrome.background.service_worker).toBe("src/sw.js");
  });

  it("backup core is registered in both content-script lists and the options page", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const fxJs = manifest.content_scripts[0].js;
    const crJs = chrome.content_scripts[0].js;
    // Same file, same position, right after the module it loads beside.
    expect(fxJs.indexOf("src/core/backup.js")).toBe(fxJs.indexOf("src/core/thread-search.js") + 1);
    expect(crJs.indexOf("src/core/backup.js")).toBe(crJs.indexOf("src/core/thread-search.js") + 1);
    // The transcript codec loads right after backup (and before store.js uses GA.core).
    expect(fxJs.indexOf("src/core/compress.js")).toBe(fxJs.indexOf("src/core/backup.js") + 1);
    expect(crJs.indexOf("src/core/compress.js")).toBe(crJs.indexOf("src/core/backup.js") + 1);
    expect(fxJs.indexOf("src/core/compress.js")).toBeLessThan(fxJs.indexOf("src/content/store.js"));
    // The transcript builder rounds out the wave-2 core block, after compress.
    expect(fxJs.indexOf("src/core/transcript.js")).toBe(fxJs.indexOf("src/core/compress.js") + 1);
    expect(crJs.indexOf("src/core/transcript.js")).toBe(crJs.indexOf("src/core/compress.js") + 1);
    // The two content-script lists never drift.
    expect(crJs).toEqual(fxJs);
    // Options page loads it after the schema it reads and before options.js.
    const html = read("src/options/options.html");
    const backupAt = html.indexOf('<script src="../core/backup.js"></script>');
    expect(backupAt).toBeGreaterThan(html.indexOf("settings-schema.js"));
    expect(backupAt).toBeLessThan(html.indexOf('<script src="options.js"></script>'));
  });

  it("tex tables + converter load right before the markdown AST that uses them", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const fxJs = manifest.content_scripts[0].js;
    const crJs = chrome.content_scripts[0].js;
    expect(fxJs.indexOf("src/core/tex-unicode.js")).toBe(
      fxJs.indexOf("src/core/tex-tables.js") + 1,
    );
    expect(fxJs.indexOf("src/core/markdown-ast.js")).toBe(
      fxJs.indexOf("src/core/tex-unicode.js") + 1,
    );
    expect(crJs).toEqual(fxJs);
    for (const rel of ["src/core/tex-tables.js", "src/core/tex-unicode.js"]) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel + " should exist").toBe(true);
    }
  });

  it("live-stream registry loads before the controller that owns it", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const fxJs = manifest.content_scripts[0].js;
    const crJs = chrome.content_scripts[0].js;
    expect(fxJs.indexOf("src/core/live-stream.js")).toBe(
      fxJs.indexOf("src/core/layout-engine.js") + 1,
    );
    expect(fxJs.indexOf("src/core/live-stream.js")).toBeLessThan(
      fxJs.indexOf("src/content/thread-controller.js"),
    );
    expect(crJs).toEqual(fxJs);
    expect(fs.existsSync(path.join(ROOT, "src/core/live-stream.js"))).toBe(true);
  });

  it("convo capture is registered in both content-script lists, right after the turns module it reads", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const fxJs = manifest.content_scripts[0].js;
    const crJs = chrome.content_scripts[0].js;
    expect(fxJs.indexOf("src/content/convo-capture.js")).toBe(
      fxJs.indexOf("src/content/turns.js") + 1,
    );
    expect(crJs.indexOf("src/content/convo-capture.js")).toBe(
      crJs.indexOf("src/content/turns.js") + 1,
    );
  });

  it("refactor-wave modules sit at their pinned positions in both content-script lists", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const fxJs = manifest.content_scripts[0].js;
    const crJs = chrome.content_scripts[0].js;
    // convo-merge (pure merge policy) loads right after the turn identity it keys by.
    expect(fxJs.indexOf("src/core/convo-merge.js")).toBe(fxJs.indexOf("src/core/turn-id.js") + 1);
    // convo-repair (sole decompress site) loads right after the store it reads/heals.
    expect(fxJs.indexOf("src/content/convo-repair.js")).toBe(
      fxJs.indexOf("src/content/store.js") + 1,
    );
    // stream-view then dialog follow thread-turn, ahead of the surfaces built on them.
    expect(fxJs.indexOf("src/content/stream-view.js")).toBe(
      fxJs.indexOf("src/content/thread-turn.js") + 1,
    );
    expect(fxJs.indexOf("src/content/dialog.js")).toBe(
      fxJs.indexOf("src/content/stream-view.js") + 1,
    );
    // the shared composer must load before the thread box that now builds on it.
    expect(fxJs.indexOf("src/content/composer.js")).toBe(
      fxJs.indexOf("src/content/undo-stack.js") + 1,
    );
    expect(fxJs.indexOf("src/content/composer.js")).toBeLessThan(
      fxJs.indexOf("src/content/thread-ui.js"),
    );
    expect(crJs).toEqual(fxJs);
    for (const rel of [
      "src/core/convo-merge.js",
      "src/content/convo-repair.js",
      "src/content/stream-view.js",
      "src/content/dialog.js",
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel + " should exist").toBe(true);
    }
  });

  it("labels-wave modules sit at their pinned positions in both content-script lists", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const fxJs = manifest.content_scripts[0].js;
    const crJs = chrome.content_scripts[0].js;
    // label grammar closes the wave-2 core block, right after the transcript builder
    expect(fxJs.indexOf("src/core/labels.js")).toBe(fxJs.indexOf("src/core/transcript.js") + 1);
    // bundle-prompt (uses compress + turn-id) then global-search (uses labels + thread-search)
    expect(fxJs.indexOf("src/core/bundle-prompt.js")).toBe(fxJs.indexOf("src/core/labels.js") + 1);
    expect(fxJs.indexOf("src/core/global-search.js")).toBe(
      fxJs.indexOf("src/core/bundle-prompt.js") + 1,
    );
    // outline (turn/thread grouping shared by transcript, bundle-prompt and the panel) closes the core block
    expect(fxJs.indexOf("src/core/outline.js")).toBe(fxJs.indexOf("src/core/global-search.js") + 1);
    expect(crJs.indexOf("src/core/outline.js")).toBe(fxJs.indexOf("src/core/outline.js"));
    // the label chip loads right after the thread box, before the surfaces that mount it
    expect(fxJs.indexOf("src/content/label-ui.js")).toBe(
      fxJs.indexOf("src/content/thread-ui.js") + 1,
    );
    // shared DOM leaves load right after the icons they build on, before every consumer
    expect(fxJs.indexOf("src/content/ui-bits.js")).toBe(fxJs.indexOf("src/content/icons.js") + 1);
    expect(fxJs.indexOf("src/content/ui-bits.js")).toBeLessThan(
      fxJs.indexOf("src/content/thread-ui.js"),
    );
    // the All-chats sub-feature loads right before the panel shell that mounts it
    expect(fxJs.indexOf("src/content/panel-global.js")).toBe(
      fxJs.indexOf("src/content/panel.js") - 1,
    );
    // the shared ask transport policy loads right after the service it wraps
    expect(fxJs.indexOf("src/content/ask-flow.js")).toBe(
      fxJs.indexOf("src/content/ask-service.js") + 1,
    );
    expect(fxJs.indexOf("src/content/ask-flow.js")).toBeLessThan(
      fxJs.indexOf("src/content/thread-controller.js"),
    );
    expect(crJs).toEqual(fxJs);
    for (const rel of [
      "src/core/labels.js",
      "src/core/bundle-prompt.js",
      "src/core/global-search.js",
      "src/content/label-ui.js",
      "src/content/ask-flow.js",
      "src/content/ui-bits.js",
      "src/content/calm-scroll.js",
      "src/content/panel-global.js",
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel + " should exist").toBe(true);
    }
  });

  it("shared/hosts.js is the manifests' content-site pattern list, loaded everywhere it's read", async () => {
    const hosts = (await import("../../src/shared/hosts.js")).default;
    const chrome = JSON.parse(read("manifest.chrome.json"));
    // The four content-site match patterns must agree with both manifests
    // (manual sync — manifests can't read JS).
    expect(manifest.content_scripts[0].matches).toEqual(hosts.CONTENT_SITE_PATTERNS);
    expect(chrome.content_scripts[0].matches).toEqual(hosts.CONTENT_SITE_PATTERNS);
    // Loaded in the background lists before background.js (context menu reads it)…
    expect(fxScripts.indexOf("src/shared/hosts.js")).toBeGreaterThanOrEqual(0);
    expect(fxScripts.indexOf("src/shared/hosts.js")).toBeLessThan(
      fxScripts.indexOf("src/background.js"),
    );
    // …and registered in both content-script lists near the other shared/ files.
    const fxJs = manifest.content_scripts[0].js;
    expect(fxJs.indexOf("src/shared/hosts.js")).toBe(fxJs.indexOf("src/shared/protocol.js") + 1);
    expect(chrome.content_scripts[0].js).toEqual(fxJs);
  });

  it("onboarding page ships whole: script order, fonts on disk, site URLs pinned to the registry", async () => {
    // Ships automatically because build.js copies src/ recursively — but only
    // if every referenced file actually lives under src/ (web/ never ships).
    for (const rel of [
      "src/onboarding/welcome.html",
      "src/onboarding/welcome.css",
      "src/onboarding/welcome.js",
      "src/onboarding/fonts/space-grotesk-latin.woff2",
      "src/onboarding/fonts/space-grotesk-latin-ext.woff2",
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel + " should exist").toBe(true);
    }
    // Script order: polyfill (browser.* on Chrome pages) → schema → page script.
    const html = read("src/onboarding/welcome.html");
    const polyfillAt = html.indexOf('src="../shared/browser-polyfill.js"');
    const schemaAt = html.indexOf('src="../shared/settings-schema.js"');
    const pageAt = html.indexOf('src="welcome.js"');
    expect(polyfillAt).toBeGreaterThanOrEqual(0);
    expect(polyfillAt).toBeLessThan(schemaAt);
    expect(schemaAt).toBeLessThan(pageAt);
    // The hardcoded "Open <site>" links must match the site registry's
    // new-chat URLs — sites.js stays the single source of truth.
    const sites = (await import("../../src/core/sites.js")).default;
    for (const id of Object.keys(sites.PROVIDERS)) {
      if (!sites.PROVIDERS[id].hosts.length) continue; // API-only providers have no site
      expect(html).toContain('href="' + sites.PROVIDERS[id].newChat + '"');
    }
    // background.js opens the page by this exact path.
    expect(read("src/background.js")).toContain("src/onboarding/welcome.html");
  });

  it("blocked-injection help page ships whole and is the path injection-guard opens", () => {
    for (const rel of [
      "src/onboarding/blocked.html",
      "src/onboarding/blocked.css",
      "src/onboarding/blocked.js",
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel + " should exist").toBe(true);
    }
    const html = read("src/onboarding/blocked.html");
    expect(html).toContain('href="blocked.css"');
    expect(html).toContain('src="blocked.js"');
    // The guard opens the page by this exact path, and runs before background.js.
    expect(read("src/background/injection-guard.js")).toContain("src/onboarding/blocked.html");
    expect(fxScripts.indexOf("src/background/injection-guard.js")).toBeGreaterThanOrEqual(0);
    expect(fxScripts.indexOf("src/background/injection-guard.js")).toBeLessThan(
      fxScripts.indexOf("src/background.js"),
    );
  });

  it("release metadata stays in lockstep across both manifests and package.json", () => {
    // The version is hand-copied in three places and has drifted once before
    // (a release went out as 0.3.0 instead of 0.2.2). CI's package job also
    // keys off the package.json version — parity is load-bearing.
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const pkg = JSON.parse(read("package.json"));
    expect(chrome.version).toBe(manifest.version);
    expect(pkg.version).toBe(manifest.version);
    expect(chrome.name).toBe(manifest.name);
    expect(chrome.description).toBe(manifest.description);
    expect(chrome.permissions).toEqual(manifest.permissions);
    expect(chrome.host_permissions).toEqual(manifest.host_permissions);
  });

  it("dependency helpers load before the clients that use them", () => {
    const at = (rel) => fxScripts.indexOf(rel);
    expect(at("src/shared/sse.js")).toBeGreaterThanOrEqual(0);
    // parsers use the SSE factory
    expect(at("src/shared/sse.js")).toBeLessThan(at("src/openai/parser.js"));
    expect(at("src/shared/sse.js")).toBeLessThan(at("src/anthropic/parser.js"));
    // API clients are built by the factory, which needs api-util
    expect(at("src/background/api-util.js")).toBeLessThan(
      at("src/background/api-client-factory.js"),
    );
    expect(at("src/background/api-client-factory.js")).toBeLessThan(at("src/openai/client.js"));
    // dispatch reads the registry
    expect(at("src/background/registry.js")).toBeLessThan(at("src/background/clients.js"));
    // key-test needs protocol, api-util and the three payloads, all earlier
    expect(at("src/background/key-test.js")).toBe(at("src/background/clients.js") + 1);
    expect(at("src/background/key-test.js")).toBeLessThan(at("src/background.js"));
    expect(at("src/background/api-util.js")).toBeLessThan(at("src/background/key-test.js"));
    expect(fs.existsSync(path.join(ROOT, "src/background/key-test.js"))).toBe(true);
  });

  it("research mode: background load order, manifests' permissions, citations content script", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const at = (rel) => {
      const i = fxScripts.indexOf(rel);
      expect(i, rel + " should be a background script").toBeGreaterThanOrEqual(0);
      return i;
    };
    // the research shell chain sits after key-test (which stays clients + 1)
    expect(at("src/background/research-tools.js")).toBeGreaterThan(
      at("src/background/key-test.js"),
    );
    expect(at("src/background/research-loop.js")).toBeGreaterThan(
      at("src/background/research-tools.js"),
    );
    expect(at("src/background/research.js")).toBeGreaterThan(at("src/background/research-loop.js"));
    expect(at("src/background/research.js")).toBeLessThan(at("src/background.js"));
    // OpenRouter reuses the OpenAI payload/tools factories at load time
    expect(at("src/openrouter/payload.js")).toBeGreaterThan(at("src/openai/payload.js"));
    expect(at("src/openrouter/client.js")).toBeGreaterThan(at("src/openrouter/payload.js"));
    expect(at("src/openrouter/client.js")).toBeGreaterThan(at("src/openai/parser.js"));
    expect(at("src/openrouter/tools.js")).toBeGreaterThan(at("src/openai/tools.js"));
    // engines after both engines; engines after the html-text helpers ddg uses
    expect(at("src/search/engines.js")).toBeGreaterThan(at("src/search/ddg.js"));
    expect(at("src/search/engines.js")).toBeGreaterThan(at("src/search/brave.js"));
    expect(at("src/search/brave.js")).toBeGreaterThan(at("src/core/html-text.js"));
    expect(at("src/search/ddg.js")).toBeGreaterThan(at("src/core/html-text.js"));
    // research.js resolves the provider through core/sites.js
    expect(at("src/core/sites.js")).toBeLessThan(at("src/background/research.js"));
    expect(at("src/core/research.js")).toBeLessThan(at("src/background/research-tools.js"));
    // permissions: identical in both manifests, three new API hosts, <all_urls> optional only
    expect(manifest.optional_host_permissions).toEqual(["<all_urls>"]);
    expect(chrome.optional_host_permissions).toEqual(manifest.optional_host_permissions);
    expect(chrome.host_permissions).toEqual(manifest.host_permissions);
    for (const host of [
      "https://openrouter.ai/*",
      "https://api.search.brave.com/*",
      "https://html.duckduckgo.com/*",
    ])
      expect(manifest.host_permissions).toContain(host);
    expect(manifest.host_permissions).not.toContain("<all_urls>");
    // [n] linkifier loads right before the markdown renderer that consumes it
    const fxJs = manifest.content_scripts[0].js;
    const crJs = chrome.content_scripts[0].js;
    expect(fxJs.indexOf("src/core/citations.js")).toBe(fxJs.indexOf("src/content/markdown.js") - 1);
    expect(crJs.indexOf("src/core/citations.js")).toBe(crJs.indexOf("src/content/markdown.js") - 1);
    expect(crJs).toEqual(fxJs);
  });

  it("shared copy (trust line + provider links) loads wherever it is read, before its readers", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const fxJs = manifest.content_scripts[0].js;
    // content scripts: right after hosts.js, ahead of stream-view.js (GA.errorCard reads it)
    expect(fxJs.indexOf("src/shared/copy.js")).toBe(fxJs.indexOf("src/shared/hosts.js") + 1);
    expect(fxJs.indexOf("src/shared/copy.js")).toBeLessThan(
      fxJs.indexOf("src/content/stream-view.js"),
    );
    expect(chrome.content_scripts[0].js).toEqual(fxJs);
    expect(fs.existsSync(path.join(ROOT, "src/shared/copy.js"))).toBe(true);
    // extension pages: copy.js precedes the page script that reads it
    for (const [page, script] of [
      ["src/options/options.html", '<script src="options.js"></script>'],
      ["src/onboarding/welcome.html", '<script src="welcome.js"></script>'],
    ]) {
      const html = read(page);
      const copyAt = html.indexOf('<script src="../shared/copy.js"></script>');
      expect(copyAt, page).toBeGreaterThanOrEqual(0);
      expect(copyAt, page).toBeLessThan(html.indexOf(script));
    }
  });

  it("options page loads polyfill then protocol ahead of options.js (key-test messaging)", () => {
    // Script order: polyfill (browser.* on Chrome pages) → schema → protocol →
    // backup → options.js. The Test button sends MSG_TEST_KEY/MSG_LIST_MODELS
    // via browser.runtime.sendMessage, so polyfill + protocol must precede it.
    const html = read("src/options/options.html");
    const polyfillAt = html.indexOf('src="../shared/browser-polyfill.js"');
    const schemaAt = html.indexOf('src="../shared/settings-schema.js"');
    const protocolAt = html.indexOf('src="../shared/protocol.js"');
    const pageAt = html.indexOf('<script src="options.js"></script>');
    expect(polyfillAt).toBeGreaterThanOrEqual(0);
    expect(polyfillAt).toBeLessThan(schemaAt);
    expect(schemaAt).toBeLessThan(protocolAt);
    expect(protocolAt).toBeLessThan(pageAt);
  });
});
