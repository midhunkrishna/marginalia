# Ops — build, test locally & publish

How to build the extension, load it in a browser for testing, and submit it to the
**Chrome Web Store** and **Firefox Add-ons (AMO)**. For what the extension _is_, see
the top-level [README](../README.md).

---

## 1. Build & package

One source tree (`src/` + `icons/`) builds both browsers. [`build.js`](../build.js)
copies it into `dist/<target>/` with the right manifest, then `web-ext` zips each.

| Target  | Manifest               | Background                 | Icons        | Unpacked dir   | Package                                              |
| ------- | ---------------------- | -------------------------- | ------------ | -------------- | ---------------------------------------------------- |
| Firefox | `manifest.json`        | `background.scripts`       | `icon.svg`   | `dist/firefox` | `web-ext-artifacts/firefox/marginalia-<version>.zip` |
| Chrome  | `manifest.chrome.json` | `src/sw.js` service worker | `icon-*.png` | `dist/chrome`  | `web-ext-artifacts/chrome/marginalia-<version>.zip`  |

```bash
npm install            # once: web-ext + test tooling (Node 24 via mise)
npm test               # must be green
npm run lint           # ESLint, must be clean
npm run format:check   # Prettier, must be clean
npm run lint:ext       # web-ext manifest lint (assembles dist/firefox first)
npm run build          # -> web-ext-artifacts/{firefox,chrome}/marginalia-<version>.zip
```

Each step is independent — `lint:ext` and `build` assemble `dist/` themselves, so there
is no required order beyond "all of them must pass before you ship".
`npm run build:firefox` / `npm run build:chrome` build a single target.
To only refresh the unpacked `dist/` folders (no zips): `node build.js` (or
`node build.js firefox|chrome`).

### Regenerate the Chrome PNG icons (only if `icons/icon.svg` changes)

Chrome doesn't render SVG toolbar icons, so PNGs are committed under `icons/`. Re-rasterize with:

```bash
for s in 16 32 48 128; do rsvg-convert -w $s -h $s icons/icon.svg -o icons/icon-$s.png; done
# (ImageMagick alternative: magick -background none icons/icon.svg -resize ${s}x${s} icons/icon-$s.png)
```

---

## 2. Test locally in a real browser

Two ways: let `web-ext` launch a throwaway browser profile for you (fastest loop), or
load the built extension into your normal browser by hand (closest to what users get).

### Option A — managed dev session (`web-ext run`, auto-reloads on save)

```bash
npm start              # Firefox: loads the repo root as a temporary add-on
npm run start:chrome   # Chrome/Chromium: assembles dist/chrome first, then loads it
```

Both open a fresh profile on https://gemini.google.com/app — **log in to the site(s)
inside that profile** before testing the no-API-key web-session paths.
Note for Chrome: `web-ext run` loads `dist/chrome`, which is a **copy** — after editing
`src/`, re-run `node build.js chrome` and the session picks the change up on reload
(Firefox's `npm start` runs from the repo root, so edits are picked up directly).

### Option B — load the local bundle by hand

Build the unpacked folders first: `node build.js` (creates `dist/firefox` and `dist/chrome`).

**Firefox (temporary add-on — lasts until Firefox restarts):**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Pick `dist/firefox/manifest.json` (any file inside `dist/firefox` works).
4. After code changes: rebuild (`node build.js firefox`), then click **Reload** on the
   add-on's card. A _permanent_ install of an unsigned build is not possible on release
   Firefox — that's what §5's signing flow is for.

**Chrome / Chromium / Edge (persists across restarts):**

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and pick the `dist/chrome` **folder**.
4. After code changes: rebuild (`node build.js chrome`), then press the ↻ **reload**
   icon on the extension's card (also reload the chat-site tab so the content scripts
   re-inject).

**Smoke test either way:** open a conversation on gemini.google.com / chatgpt.com
(needs an OpenAI key in the extension settings) / claude.ai, select text in an answer,
and use the **Comment** pill (or right-click → _Ask about…_, or Ctrl+Shift+H). The
extension's console logs are visible via the browser's extension debugging tools
(`about:debugging` → Inspect on Firefox; `chrome://extensions` → _service worker_ /
page DevTools on Chrome) — enable **debug logging** in the extension's settings first.

---

## 3. Before every store submission

1. **Bump the version** in **all three**: `manifest.json`, `manifest.chrome.json`, and
   `package.json` (stores reject re-uploading an existing version). Keep them identical.
2. Confirm the **extension id**. Firefox uses `browser_specific_settings.gecko.id`
   (set to `marginalia@midhunkrishna.github.io`) — it is PERMANENT once the first AMO
   version is published; never change it afterwards. Chrome assigns its own id on first upload.
3. `npm test` green, `npm run lint` + `npm run format:check` + `npm run lint:ext` clean, `npm run build`.
4. Have listing assets + text ready (see below): 128px icon (already in the package),
   1–5 screenshots, a short summary, a full description, a **privacy policy URL**, and a
   permission justification.

### Permission / data-use justification (reused by both stores)

- `contextMenus` — the right-click **"Ask about …"** menu item.
- `storage` — saves comment threads, settings, and any API keys **locally** (`storage.local`).
- `scripting` — reads the Gemini page's session token from the MAIN world (web-session mode only).
- host permissions — the three chat sites (inject the margin UI + read answers), the four
  API hosts (`api.openai.com`, `generativelanguage.googleapis.com`, `api.anthropic.com`,
  `openrouter.ai`), used only when the matching API key is set, and the two search hosts
  (`html.duckduckgo.com`, `api.search.brave.com`), used only while a Research turn runs.
- optional `<all_urls>` — granted from the options page ("Let research read web pages") so a
  Research turn can fetch the pages the model asks for (no cookies, `credentials: "omit"`).
  Never requested at install; removable from the same checkbox.
- **Data**: highlighted text + conversation context is sent to the AI backend the user chose
  (their logged-in web session, or the official API via their own key). API keys are stored
  locally and sent only to that provider. A Research turn additionally sends the model's
  search queries to the chosen search engine and fetches the pages it reads. Nothing is sent
  to any first-party server of ours.

### Store listing — first paragraph (Chrome Web Store + AMO)

The detailed description opens with the trust story, because the first paragraph is the
only part many users read. The last sentence is the trust line from
[`src/shared/copy.js`](../src/shared/copy.js) (`GA.copy.TRUST_LINE`) — paste it verbatim;
`tests/shared/copy.test.js` fails if this draft drifts from the source.

> Marginalia adds Google-Docs-style comment threads to Gemini, ChatGPT and Claude:
> highlight part of an answer, ask about it in the margin, and keep your place in the main
> chat. Local-first, no account, no analytics, no hidden caps, open source (MIT).
> Keys stay in this browser profile and are sent only to the provider you choose (OpenAI, Google, Anthropic, OpenRouter or Brave) — never to us; there is no 'us'.

---

## 4. Publish to the Chrome Web Store

1. **Developer account**: sign in at the
   [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and
   pay the **one-time US$5** registration fee (first time only).
2. `npm run build:chrome` → upload `web-ext-artifacts/chrome/marginalia-<version>.zip` via
   **Add new item**.
3. **Store listing**: name, summary (≤132 chars), detailed description, **Productivity**
   category, language, and at least one **screenshot** (1280×800 or 640×400). The 128px icon
   ships in the package; promo tiles are optional.
4. **Privacy practices**: declare a **single purpose**, justify each permission (paste from
   §3), complete the **data-usage** disclosures, and provide a **privacy policy URL** (required
   given the broad host access).
5. **Distribution**: choose **Public** or **Unlisted**, then **Submit for review** (typically
   hours to a few days).
6. **Updates**: bump the version (§3), rebuild, upload the new zip via the item's
   **Package → Upload new package**, resubmit.

---

## 5. Publish to Firefox Add-ons (AMO)

Two routes — **Option A**, a public listing on addons.mozilla.org, or **Option B**, a
Mozilla-signed `.xpi` you distribute yourself. Both need a (free) Firefox account; the
`web-ext sign` commands additionally need AMO API credentials:
[addons.mozilla.org/developers](https://addons.mozilla.org/developers/) →
**Manage API Keys** → copy the **JWT issuer** and **JWT secret**.

Common setup for either option:

```bash
export AMO_JWT_ISSUER=user:xxxxx:xxx   # from Manage API Keys
export AMO_JWT_SECRET=xxxxxxxx
node build.js firefox                  # assemble the dist/firefox folder web-ext signs
```

### Option A — Listed on AMO (public, reviewed)

```bash
npx web-ext sign --source-dir dist/firefox --channel=listed \
  --api-key="$AMO_JWT_ISSUER" --api-secret="$AMO_JWT_SECRET"
```

Alternative without API keys: `npm run build:firefox`, then upload
`web-ext-artifacts/firefox/marginalia-<version>.zip` manually via
**Developer Hub → Submit a New Add-on → "On this site"**. Either way, AMO reviews
listed add-ons before they go public; fill in the listing (summary, description,
screenshots, categories) and note the declared data collection (the manifest already
declares `data_collection_permissions: websiteContent`).

### Option B — Unlisted / self-distribution (you host the signed `.xpi`)

```bash
npx web-ext sign --source-dir dist/firefox --channel=unlisted \
  --api-key="$AMO_JWT_ISSUER" --api-secret="$AMO_JWT_SECRET" \
  --artifacts-dir web-ext-artifacts/firefox
```

This returns a Mozilla-**signed** `.xpi` you can distribute yourself; users install it via
`about:addons` → ⚙ → **Install Add-on From File…**. (An _unsigned_ build only installs
permanently on Developer Edition / Nightly / ESR with
`about:config → xpinstall.signatures.required = false`; for everyday local testing use
the temporary-add-on flow in §2 instead.)

**Updates**: bump the version (§3), rebuild `dist/firefox`, re-sign (Option B) or
re-submit the new version on the existing listing (Option A).

---

## 6. Caveats for review

- **Web-session backends are reverse-engineered.** The default (no-key) Gemini/Claude paths
  replay each site's private endpoints, which may conflict with those sites' Terms of Service —
  store reviewers can flag this. The **API-key path** (OpenAI / Google AI / Anthropic, using the
  user's own key) is the cleaner story for a public listing; consider shipping API-key-only if a
  reviewer objects.
- **ChatGPT is API-key-only** (its web session is Cloudflare-Turnstile-gated); there is no web
  fallback.
- **Icons**: Chrome needs the PNGs (`icon-16/32/48/128.png`); Firefox uses `icon.svg`. Both are
  committed.
- **`web-ext lint` must pass** for AMO; run `npm run lint:ext` first.
- Keep `manifest.json` and `manifest.chrome.json` in sync (name, version, permissions, content
  scripts) — only the background entry, the icon format, and the Firefox-only
  `browser_specific_settings` should differ. The Firefox `background.scripts` list and Chrome's
  `src/sw.js` `importScripts()` must name the same modules in the same order (load order matters);
  `tests/build/wiring.test.js` enforces this, so `npm test` fails if they drift.
