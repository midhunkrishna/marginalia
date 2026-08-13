# Marginalia

> Just here to learn how to install and use Marginalia?
>
> 1. [Marginalia Website](http://marginalia.midhun-krishna-usa.workers.dev/)
> 2. See [`usage instructions`](ops/using.md)

A browser extension (**Firefox + Chrome**) that adds **Google-Docs-style margin
comment threads** to the major AI chat sites — [Gemini](https://gemini.google.com),
[ChatGPT](https://chatgpt.com), and [Claude](https://claude.ai).

When the AI gives a long answer and you want to drill into one phrase, you no
longer have to ask in the main chat (and bury the original answer). Instead:

1. **Highlight** the phrase (e.g. _"8 KB page"_).
2. Click the floating **Comment / Ask** pill that appears — or **right-click →
   "Ask about …"**, or press **Ctrl + Shift + H**.
3. A comment box opens **in the right margin, level with your highlight**
   (Docs-style: focusing a box aligns it with its highlight and shifts the
   others out of the way; hovering either one lights up the other).
4. Ask your follow-up. The reply streams **into the box** — your main chat is
   untouched. **Stop** cancels mid-stream and keeps the partial answer; a
   failed request shows an error card with **Retry**.
5. Keep the conversation going; the box re-sends the full thread each turn.

The follow-up is answered by **the same AI you're on** (ask Claude on claude.ai,
GPT on chatgpt.com, Gemini on gemini.google.com), and the extension's UI follows
**the site's light/dark theme**, not the OS's.

Threads are multi-turn, height-capped, **persist per conversation (and per site)**,
and re-anchor to their highlight on reload. Each box can be **minimized** to a
compact chip (with an unread dot when a reply lands while it's tucked away),
docked normally, **maximized** to a full-screen modal (with its own composer),
or **resolved** — archived but restorable, distinct from delete. An all-threads
panel (**Alt + Shift + A**) lists everything with open/resolved filters and
click-to-jump; **Alt + ↓/↑** cycles threads, **Alt + Shift + C** collapses or
expands them all, and **Alt + Shift + H** hides or shows the highlight tint for
re-reading clean text. Replies render markdown incl. tables and nested lists, with
copy buttons on replies and code blocks. On narrow windows the margin collapses
to a chip rail (chips open the modal); on very narrow ones highlights open the
modal directly.

## Features at a glance

- **Margin comment threads** — highlight any part of an AI answer and discuss
  just that part, without touching the main chat.
- **Labels** — tag highlights (`project.ux`-style dotted families) via the tag
  button or `/label`, as standalone tag chips or on top of threads.
- **Across-chats search & synthesis** — search every annotated conversation,
  pick threads/labels, and ask one prompt across the bundle ("summarize
  these", "find the patterns"); carry the answer into a new chat or download
  it as Markdown.
- **Transcripts & export** — annotated conversations are captured locally and
  export (with your comments) to NotebookLM/Obsidian-ready Markdown; full
  backup/restore from the options page.
- **Comfortable reading** — markdown + math rendering, resizable full-screen
  view, optional calm scrolling while answers stream, focus mode, keyboard
  navigation, per-site light/dark theming.
- **Your choice of plumbing** — official APIs (OpenAI / Google AI / Anthropic)
  with your keys, or your logged-in Gemini/Claude session with no key at all.

The full, user-friendly list — release by release — lives in
[`docs/features.md`](docs/features.md).

## How it talks to each AI

Two ways, chosen per site by whether you've set an API key (in Settings):

- **Official API (recommended, robust).** Set an API key for a provider and its
  follow-ups go through the documented API from the background script:
  **OpenAI** (`src/openai/`), **Google AI / Gemini** (`src/googleai/`), or
  **Anthropic** (`src/anthropic/`). Won't break on website changes; billed to your
  account. **ChatGPT requires this** — see below.
- **Logged-in web session (no key).** With no key set, Gemini and Claude reuse your
  **already-logged-in session** on the page: cookies attach automatically and the
  extension replays that site's own internal streaming endpoint
  (`src/gemini/`, `src/claude/`). Which backend answers is chosen by the current
  host (see [`src/core/sites.js`](src/core/sites.js)).

> ⚠️ **The web-session endpoints are undocumented and reverse-engineered** — a
> vendor can change them without notice. The fragile bits per site are isolated in
> small unit-tested `payload.js`/`parser.js` modules; if replies stop, inspect a
> real request in DevTools → Network and adjust them.
>
> **ChatGPT is API-key-only:** chatgpt.com gates its web endpoint behind Cloudflare
> Turnstile, which can't be solved from an extension, so the web client was removed.
> Add an OpenAI key in Settings to use ChatGPT. Built for personal use.

## Build

One source tree builds **both** browsers; everything in `src/` is shared. The only
per-browser differences are the manifest and the background entry:

| Target  | Manifest               | Background                 | Icons        | Package output                                       |
| ------- | ---------------------- | -------------------------- | ------------ | ---------------------------------------------------- |
| Firefox | `manifest.json`        | `background.scripts`       | `icon.svg`   | `web-ext-artifacts/firefox/marginalia-<version>.zip` |
| Chrome  | `manifest.chrome.json` | `src/sw.js` service worker | `icon-*.png` | `web-ext-artifacts/chrome/marginalia-<version>.zip`  |

A tiny [`src/shared/browser-polyfill.js`](src/shared/browser-polyfill.js) aliases
`browser` → `chrome`, so the shared code runs unchanged on both.
[`build.js`](build.js) assembles `dist/firefox` and `dist/chrome` from `src/` +
`icons/` (dropping in the right manifest), then `web-ext` zips each.

```bash
npm install            # once: web-ext + test tooling (Node 24 via mise)

npm run build          # both targets
npm run build:firefox  # just Firefox
npm run build:chrome   # just Chrome
```

### Checks

```bash
npm test               # vitest suite (includes manifest/sw.js wiring drift guards)
npm run lint           # ESLint
npm run format:check   # Prettier (npm run format to write)
npm run lint:ext       # web-ext validation of the built Firefox manifest
```

GitLab CI ([`.gitlab-ci.yml`](.gitlab-ci.yml)) runs the same checks on every
push, and additionally packages both zips as pipeline artifacts when a commit
on the default branch bumps the version (package.json + both manifests must
agree — a wiring test enforces the parity).

### Tools

- [`tools/gen-tex-tables.js`](tools/gen-tex-tables.js) regenerates the
  generated `src/core/tex-tables.js` from a sibling checkout of
  `latex-to-unicode` (defaults to `../latex-to-unicode`; see its header).
- [`tools/probe-turns.js`](tools/probe-turns.js) is pasted into a site's
  DevTools console to probe which turn selectors match — used when a vendor
  changes their DOM.

### Run during development (temporary, auto-reload)

```bash
npm start              # Firefox          (web-ext run, loads this folder)
npm run start:chrome   # Chrome/Chromium  (assembles dist/chrome, then web-ext run)
```

Both launch a throwaway browser profile — log in to the AI site(s) inside it before
testing the no-API-key web-session paths.

### Load a local bundle into your own browser

`node build.js` writes the unpacked extension to `dist/firefox` and `dist/chrome`:

- **Firefox**: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** →
  pick `dist/firefox/manifest.json` (temporary — gone after a restart).
- **Chrome**: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
  pick the `dist/chrome` folder (persists across restarts).

After editing `src/`, rebuild and hit the extension's **Reload** button in that page
(and refresh the chat-site tab). Full details — including signing, store submission,
and permission justifications — live in [`ops/instructions.md`](ops/instructions.md).

Or load it by hand:

- **Firefox** — `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**
  → pick this folder's `manifest.json`.
- **Chrome** — `npm run build:chrome`, then `chrome://extensions` → enable
  **Developer mode** → **Load unpacked** → pick `dist/chrome`.

Then open a logged-in Gemini / ChatGPT / Claude tab and try it.

### Install permanently / publish

Packaging, signing for permanent local installs, and submitting to the **Chrome Web
Store** and **Firefox Add-ons (AMO)** are documented in
[`ops/instructions.md`](ops/instructions.md).

## Settings

Click the toolbar icon (or open the extension's options page — Firefox: `about:addons`
→ Preferences; Chrome: `chrome://extensions` → Details → Extension options):

- **Keyboard shortcut** — rebind the trigger (default Ctrl+Shift+H).
- **Context scope** — highlight only / highlight + section (default) / whole conversation.
- **AI backends — optional API keys** — per-provider OpenAI / Google AI / Anthropic key
  - model. Empty = use that site's logged-in web session; set = use the official API.
    ChatGPT needs a key (its web session is Turnstile-blocked). Keys are stored in
    `browser.storage.local` (this profile only, not synced) and sent only to the provider.
- **Backup** — export/import all threads + transcripts as JSON.
- **Comment button** — show/hide the floating pill on text selection.
- **Calm scrolling** — hold the view steady while an answer streams; a
  scroll-down button marks the text growing below (off by default).
- **Delete all saved threads.**
- **Debug logging** — also emits `[marginalia perf]` hot-path timing summaries.

## Architecture

The code is organized as a **functional core, imperative shell**. The pure
"core" modules hold the tricky logic with no DOM/network/`browser.*` dependency,
so they're exhaustively unit-tested; the DOM/IO "shell" modules are thin adapters
that delegate to the core. A tiny UMD footer on each core module lets Node/Vitest
import it while the browser still loads it as a `GA`-global content script.

```
manifest.json              MV3, Firefox (background.scripts)
manifest.chrome.json       MV3, Chrome  (background.service_worker)
build.js                   assemble dist/{firefox,chrome} from src/ + icons/
src/
  sw.js                    Chrome service-worker entry (importScripts the bg modules)
  shared/                  one source of truth, shared across contexts
    browser-polyfill.js      alias browser -> chrome (loaded first everywhere)
    protocol.js              message + port name constants (content <-> background)
    settings-schema.js       settings keys + defaults (content, background, options)
    config.js                named timing/size constants (no magic numbers)
    sse.js                   SSE parser factory (the data:/[DONE] loop) for the API parsers
  core/                    PURE, no DOM/IO — unit-tested directly
    sites.js                 site registry: host -> provider, session id, answer selectors
    tokens.js                scrape session tokens from inline-script text (Gemini)
    prompt.js                compose the prompt (+ context-scope Strategy)
    anchor-match.js          TextQuoteSelector best-match scoring
    turn-id.js               turn fingerprints + fuzzy similarity (re-anchor identity)
    markdown-ast.js          markdown -> AST, incl. incremental parseStream for streaming
    tex-unicode.js           TeX -> Unicode prettifier (tex-tables.js is generated)
    layout-engine.js         margin layout math: placement, height-share, orphan cluster
    live-stream.js           in-flight answer registry (modal late-joins a stream)
    session-bindings.js      thread -> conversation pins (persists never cross buckets)
    labels.js                label grammar: parse/merge/validate dotted names
    thread-search.js         panel search matching
    global-search.js         across-chats search over stored records
    bundle-prompt.js         across-chats synthesis prompt bundling
    transcript.js            stored record -> exportable transcript
    convo-merge.js           transcript merge policy (provable merges, stale upgrades)
    compress.js              per-message gzip <-> base64 blob codec
    backup.js                export/import archive + order-preserving turn merge
    cycle.js                 Alt+arrow thread-cycling order
    adder-position.js        floating Comment-pill placement math
    theme.js                 site light/dark detection logic
  gemini/ claude/           web-session backend per site (parser/payload/client)
    parser.js                PURE: that site's streaming response -> answer
    payload.js               PURE: build that site's request body + URLs
    client.js                strategy: transport + auth + streaming only
  openai/ googleai/ anthropic/  official-API backends (used when a key is set)
    parser.js                PURE: SSE text extractor (built on shared/sse.js)
    payload.js               PURE: buildRequest -> { url, headers, body }
    client.js                thin per-provider config passed to the api-client factory
  background/
    api-util.js              shared SSE streaming loop + request abort/timeout budget + API errors
    api-client-factory.js    builds the official-API clients from each provider's config
    registry.js              provider -> client mapping (single source of truth for dispatch)
    clients.js               ask router: key set ? API client : web client (reads the registry)
  background.js            context menu + ask router; reads settings; Gemini web fetch + token read
  content/                 imperative shell (DOM/IO; GA-global)
    util.js                  namespace, settings load, GA.provider, DOM builder, toast
    frame.js                 named rAF task coalescing (one pass per frame)
    perf.js                  debug-gated hot-path timing ([marginalia perf] summaries)
    icons.js                 inline-SVG icon factory (no innerHTML)
    ui-bits.js               small shared widgets: pills, error card, confirm popover
    store.js                 storage.local, keyed by "<provider>:<id>" conversation
    markdown.js              render the markdown AST -> DOM (XSS-safe)
    anchor.js                Range <-> offset mapping + TreeWalker (uses anchor-match)
    turns.js                 turn discovery + fingerprint cache over the page DOM
    selection.js             capture selection, wrap/unwrap highlight spans
    adder.js                 floating Comment pill on text selection
    composer.js              shared ask/stop input (autosize, MD toggle, undo)
    undo-stack.js            composer-local undo (restore cleared/sent text)
    stream-view.js           streaming-answer state machine (shared by box + modal)
    calm-scroll.js           auto-scroll policy: stick-follow / calm hold + button
    thread-turn.js           presenter for one Q&A turn (testable with fakes)
    thread-ui.js             one comment box (view): minimize / normal / maximize
    label-strip.js           shared label chips + inline editor (box + modal)
    label-ui.js              standalone label-chip surface
    dialog.js                modal dialog chrome (overlay, focus, Esc)
    modal.js                 full-screen thread view
    panel.js                 all-threads panel (filters, search, jump)
    panel-global.js          Across-chats tab: global search + synthesis runs
    gutter.js                margin VIEW: reads the page, applies layout-engine output
    keyboard-nav.js          Alt+arrow cycling, collapse-all, focus moves
    convo-capture.js         capture the page transcript into the convo record
    convo-repair.js          heal + decode stored transcripts (export path)
    theme-detector.js        live site light/dark observer
    token-provider.js        get session tokens (scrape + MAIN-world fallback + cache)
    ask-flow.js              auth policy over askService: web tokens + one AUTH retry
    ask-service.js           Facade over the background ask port (tags each ask w/ provider)
    triggers.js              context-menu + keyboard shortcut
    navigation.js            SPA route-change detection
    reanchorer.js            re-anchor orphans on mutation/scroll (single scroll entry)
    thread-controller.js     thread lifecycle + ask round-trip
    content.js               entry point — wires the collaborators together
  options/                 settings page (shortcut, scope, API keys, data, debug)
  styles/content.css       all namespaced ga-* styles
icons/icon.svg + icon-{16,32,48,128}.png   (PNGs for Chrome; SVG for Firefox)
tests/                     Vitest specs (pure: node; DOM: jsdom via tests/helpers/loadGA.js)
```

## Tests

```bash
npm test            # vitest run (pure cores in node, DOM modules in jsdom)
npm run test:watch  # watch mode
npm run test:cov    # coverage (core/*, each provider's parser|payload|client, and the background factory/registry)
```

## Known limitations

- Selectors for each site's answer container (`responseSelectors` in
  `core/sites.js`) are heuristic; extend them if anchoring misses. The Gemini and
  Claude **web-session** backends are reverse-engineered and may need re-tuning when
  those sites change their internals — set an API key to avoid that (see "How it
  talks to each AI"). ChatGPT is API-key-only.
- On narrow windows with no empty right margin, boxes overlap the chat (a
  marker-collapse fallback is planned).
- A thread whose highlight isn't in the DOM (page still loading, or the answer
  was edited/regenerated) becomes **orphaned** rather than being deleted. Orphans
  re-anchor automatically as their text scrolls into view; while orphaned, a lone
  one parks at the bottom of the margin and **2+ collapse into a single counted
  badge** (bottom-right) that opens a scrollable drawer.

## Troubleshooting

### The context menu appears but clicking it does nothing

On a corporate (managed) profile, the extension can be silently dead: the
context menu is registered for the page (so the browser matched the host), but
the content script never injected. When Marginalia detects this — the menu click
reaches no content script — it opens a guidance page naming the cause. The usual
fixes:

- **Site access:** `chrome://extensions` → Marginalia → *Site access* → allow
  this site (or all sites), then reload the page.
- **Admin policy:** `chrome://policy` shows `ExtensionSettings` /
  `runtime_blocked_hosts` entries that block `*.google.com` (or other hosts) for
  extensions; ask your administrator to allow Marginalia's hosts.
- **Firefox quarantined domains:** check the add-on's permissions in
  `about:addons`; Mozilla may quarantine some domains by default.

No manifest change can override an admin policy — the extension can only make
the block diagnosable, which is exactly what this detection does.

## License

[MIT](LICENSE)
