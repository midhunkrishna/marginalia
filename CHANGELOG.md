# Changelog

Notable changes to Marginalia. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## Unreleased

### Added

- **Selector health check.** If a supported site changes its markup and
  Marginalia's selectors stop matching an open conversation for ~10 seconds,
  a single dismissible notice now says so, suggests checking for an extension
  update, and links to a prefilled "Report it" GitHub issue (site, failed
  selector tier, extension version). Shown at most once per browser session
  per site; never on new chats, in hidden tabs, or while a page is still
  loading. With Debug on, the failed tier is logged and set as
  `data-ga-health` on `<html>`.
- **Highlight visibility toggle.** A gutter eye button (stacked above the
  all-threads button) and **Alt + Shift + H** hide the highlight tint for
  re-reading a thread-heavy page, keeping a faint dotted underline so
  hover-linking and clicking through to a thread still work. Per-page-session
  only, not persisted.
- **Research mode.** A **Research** toggle next to the MD button turns a
  question into a short web-research run with your own API key: the model
  searches (`web_search`) and optionally reads pages (`read_page`), the thread
  shows live "Searching: …" / "Reading: …" steps, and the answer streams with
  clickable `[n]` citations and a Sources block, saved like any reply. Stop
  keeps the partial answer. Settings: a "Use for research" checkbox on each
  provider row, a search engine (DuckDuckGo with no key, or Brave Search with
  your key), an optional "Read web pages" permission, and limits on steps,
  searches, and pages read.
- **OpenRouter provider.** Add an OpenRouter key and a model slug in Settings
  (with the same Test button and model list as the other providers); it shows
  up in the "Answer with" picker on every site and can be the research
  provider.

### Changed

- **Privacy policy and permissions.** PRIVACY.md and the welcome page now
  describe Research mode's extra destinations (your chosen search engine and
  the pages it reads, only during a research turn). New host permissions:
  `openrouter.ai`, `api.search.brave.com`, `html.duckduckgo.com`; new
  optional `<all_urls>`, requested only from the options page and removable
  there.

## 0.4.1 — 2026-07-28

A one-change patch: less ceremony around deleting.

### Changed

- **Deleting an empty thread no longer asks for confirmation.** The
  "Delete this thread?" popover now appears only when there's something to
  lose — a conversation in the thread, or unsent text in the composer. A
  freshly opened thread deletes with one click (or Del).

## 0.4.0 — 2026-07-27

The performance release, plus a threads-panel polish wave: the same extension
made fast enough for conversations carrying 100+ comment threads, with a
calmer, roomier panel on top.

### Added

- **Themed checkboxes in the threads panel.** The selection checkboxes
  (labels picker, thread rows, matched items) now match the extension's flat
  look — a rounded accent-filled box with a proper check mark — instead of
  the browser's native square.
- **Collapsible label sections.** The Across-chats label picker's namespace
  groups fold behind chevron headers instead of spending a line per label.
  Sections start closed, except the ones holding your current picks; a live
  search opens whatever it matched; your own opens/closes stick for the rest
  of the panel visit.
- **Drag-resizable threads panel.** Drag any edge or corner to resize the
  panel in both directions — it stays centered while you drag, and the chosen
  size is remembered for the rest of the page session (the same convention as
  the maximized thread view's width).

### Changed

- **No more freezes on heavily-annotated conversations.** Re-anchoring now
  does work proportional to what actually changed on the page instead of
  rescanning every thread against the whole conversation on every frame —
  and the extension no longer wakes itself up for its own UI's mutations
  and scrolls.
- **Fast page loads, however much you've annotated.** Loading a conversation
  no longer reads every stored transcript to find drafts, anchors all
  threads in a single shared pass, and renders each box's visible messages
  first — older history fills in quietly behind the scroll.
- **Streaming stays smooth to the end of long answers.** Streamed markdown
  is parsed incrementally (only the growing tail), formulas are converted
  once instead of on every frame, and long answers batch their repaints
  imperceptibly. What you see stream is pixel-identical to what a reload
  renders.
- **Transcript capture only works when there's work.** Scrolling around an
  already-captured conversation costs nothing; unchanged records are never
  rewritten to storage.
- Debug logging now includes performance summaries (`[marginalia perf]` in
  the console) for verifying all of the above.
- The composer's Ask button is slimmer (half the vertical padding).

### Fixed

- **The composer grows to fit what you type.** The input used to stop at
  ~6 lines and scroll internally, hiding earlier lines; it now keeps
  growing (up to 40% of the window) while the thread box rises to make
  room — everything you've typed stays visible.
- **No more flicker while an answer streams into a bottom-pinned box.** The
  box now grows and lifts in the same frame: streamed content used to push
  the box's bottom edge down into the reserved strip and jerk back up
  whenever an unrelated relayout happened to run — and could randomly
  inherit an easing meant for a deliberate shift, mixing slides with snaps.
- **Highlighting across several bullets no longer disturbs the page's list
  styling.** Invisible whitespace between list items (and table rows) used
  to get wrapped in highlight spans, confusing the host page's list CSS and
  occasionally rendering stray highlighted slivers — and on triple-click
  selections the box could anchor to one of those invisible slivers.

## 0.3.2 — 2026-07-23

The reading comfort release.

### Added

- **Calm scrolling** (off by default, options page). While an answer
  streams, the view follows only its first few lines and then holds still —
  no more text racing past faster than you can read. A circled scroll-down
  button inside the thread marks the text growing below; click it (or
  scroll to the bottom yourself) to jump to the newest text and follow
  along again. Works in margin boxes, the maximized view, and Across-chats
  synthesis.
- **Full-width input.** The composer's input now spans the whole box; the
  MD toggle and Ask button moved to a slim row underneath, so typing room
  is never traded for buttons.
- **Labels in the maximized view.** The label section (chips, ×-remove,
  pencil editor) now appears under the maximized view's header too, and
  `/label` typed there updates it in place — full parity with the margin
  box.

### Fixed

- Minimizing the maximized view with an empty input no longer collapses the
  margin box's input to a sliver.
- With calm scrolling off, the maximized view and the synthesis panel now
  respect your scroll position while streaming (stick-follow, like the
  margin boxes) instead of yanking to the bottom on every update.

## 0.3.1 — 2026-07-22

The composer comfort release.

### Added

- **Drafts follow you.** Text typed in a margin box travels into the
  maximized view's input when you expand, and any unsent text comes back to
  the box when you close it.
- **Markdown toggle.** A small MD button on the composer (margin box and
  maximized view) lets you choose, per message, whether what you send is
  rendered as markdown — code fences, lists and all — in your own bubble.
  The choice is remembered on the message, so it survives reloads. Plain
  Enter inside an unclosed ``` fence now inserts a newline instead of
  sending (Ctrl/Cmd+Enter always sends).
- **Resizable input in the maximized view.** A drag grip above the input
  lets you pull it as tall as half the window; double-click the grip to
  return to auto-grow. The margin boxes keep their compact auto-size.

## 0.3.0 — 2026-07-22

The labels & cross-conversation synthesis release: annotations become
organizable (labels with dotted namespaces) and mineable across every
conversation you've annotated.

### Added

- **Labels.** Type `/label "name"` in any thread composer. In a thread with
  history it attaches labels (editable in place via the pencil in the label
  section under the header; the minimized chip gains a tag icon). In an EMPTY
  thread it converts the record into a standalone label — a violet tag chip
  that marks the whole LLM answer, with its own in-chip editor. Compound
  labels use dotted namespaces (`project.ux.nav`); multiple labels per item.
- **"Across chats" tab in the threads panel.** Search threads across every
  stored conversation, or flip the Threads|Labels segmented control and pick
  from a namespace-grouped picker (selecting `project` matches everything
  under `project.*`). Matched threads and labeled answers list for curation.
- **Cross-conversation synthesis.** With items selected, a prompt bar
  appears: ask for a summary / common patterns and the bundle (thread
  discussions + the transcript text of labeled answers) goes to the current
  provider, streaming into the panel. Labeled answers resolve by inflating
  only their own per-message blob; the whole-conversation decode runs only on
  a fingerprint miss, and a missing transcript degrades to the stored
  section text.
- **Output actions.** "Download .md" saves the output verbatim under a
  small provenance header (date, prompt, sources) — no second LLM round-trip.
  "Copy & open new chat" copies the output and opens the provider's new-chat
  page (none of the sites expose a create-conversation API, so paste-to-start
  is the honest version of this feature).
- Transcript exports now include a **Labels:** line in annotation callouts.

### Changed (UX pass, same release)

- **Labeling got a visible door.** A tag button on every comment box opens
  label entry directly — no syntax to learn; `/label` remains the typed
  power path (the empty-box placeholder hints it).
- **One label editor everywhere.** The thread label section now uses the
  same pill-by-pill editor as the tag chip (× removes one, the input adds);
  the raw-text editor with its quoting rules is gone.
- **Tag chips are label-first.** The chip leads with the tag name you wrote
  (extras as "+N", pencil on hover); the highlight snippet trails muted.
- **Synthesis output is a run log.** A second prompt appends below a divider
  instead of silently replacing the previous answer; a failed run puts the
  typed prompt back in the composer; "Gathering the selected items…" shows
  while sources resolve.
- The synthesis footer is always visible on the Across-chats tab with a
  short how-to hint; submitting with nothing selected explains itself.
- Label names are capped at 64 characters and can't contain `"` — they flow
  into pills, chips, and toasts sized for tags.
- Escape no longer closes the panel over a typed-but-unsent prompt (first
  press blurs, second closes); long content stopped clipping (toast widths,
  pill remove buttons, tab wrapping on narrow windows); focus rings, hover
  states, and reduced-motion coverage filled in across the new controls.

### Fixed (post-review, same release)

- Closing the panel while a synthesis bundle was still resolving no longer
  dispatches the provider request for the dead panel.
- Labels appended via the modal's `/label` now render on the docked box as
  soon as the modal closes (previously stale until reload).
- Re-picking a label after changing the selection no longer resurrects stale
  curation unchecks; label names containing a double quote are rejected
  (they could never round-trip through the editors).

## 0.2.2 — 2026-07-18

The modal UX release.

### Added

- **Drag-resizable modal.** The full-screen thread view resizes from either
  edge (width clamped to the viewport) and remembers the chosen width for
  the rest of the page session.
- **Live-stream late-join.** Opening the modal while an answer is still
  streaming into the docked box picks the stream up mid-sentence instead of
  waiting for the turn to finish (shared feed in `core/live-stream.js`).
- **Minimize on expand.** While a thread is maximized, its docked box tucks
  to a chip (transient — never persisted) and restores to its prior state
  when the modal closes.

## 0.2.1 — 2026-07-17

The math release.

### Added

- **Math rendering.** TeX notation in replies (`\frac{a}{b}`, Greek letters,
  super/subscripts, common operators) renders as Unicode math in boxes and
  the modal — a lightweight TeX→Unicode prettifier, no external math engine.

## 0.2.0 — 2026-07-13

The transcript & durability release: annotated conversations are now captured
as full transcripts, exportable for NotebookLM, and every layer of thread
storage got hardened against data loss.

### Added

- **Conversation transcript capture.** Annotated conversations are captured
  into local storage from the live page — accumulated across visits and
  scrolls in both directions, so virtualized message lists still yield the
  whole conversation over time. Message text is gzip-compressed per turn;
  capture runs on annotate, on revisit, and after streaming settles.
- **Export for NotebookLM.** One-click button in the threads panel renders
  the captured transcript plus your annotations to Markdown (NotebookLM- and
  Obsidian-ready), downloads it, and copies it to the clipboard. Annotations
  appear as callouts under the turn they were written on; mid-stream partial
  duplicates are collapsed at render time.
- **Backup export / import.** Options page can export all threads and
  transcripts to a JSON archive and restore it later — additive merge (safe
  union, content-max conflict resolution) or wholesale replace. Restores can
  never touch settings or API keys by construction.
- **Options shortcut.** Gear button in the threads panel opens the options
  page directly.

### Fixed

- **Wedged transcript index (F6).** Annotating while an answer was still
  streaming (or before a turn finished hydrating) indexed the turn under a
  fingerprint that never appeared again, permanently freezing the transcript
  at that first window — the NotebookLM export then contained only the
  annotated turns. Capture now recognizes a stored partial that a live turn
  grew out of and upgrades it in place; exports self-heal older wedged
  records (export once, revisit, export again — the second export is
  complete); annotations anchored to a vanished partial re-home onto the
  completed turn by their quoted text.
- **Draft retention (T-004).** Draft conversations with content are never
  auto-deleted; only provably stale empty drafts are swept.
- **Restore isolation.** One malformed stored thread can no longer abort the
  restore loop and hide every other annotation in the conversation; the bad
  record is skipped and left intact for later migration.

## 0.1.1 — earlier store update

- Anchoring rework: threads pin to their message via turn discovery + content
  fingerprinting; anchors that contradict recorded context are rejected
  instead of guessed. Fixed two dead site adapters (Gemini, Claude).
- Threads panel: keyword search across all threads; focus mode (opening one
  thread collapses the rest); composer-local undo/redo (Ctrl+Z).
- UI polish pass: flat host-matched colors, unified counters, elevation
  system, calmer chips; panel button moved bottom-right; fixed Alt shortcuts
  on macOS. Fixed Firefox anchoring probe and highlight scroll lag.
- Renamed to Marginalia; added privacy policy for store listings.

## 0.1.0 — initial release

- Margin annotations ("threads") on Gemini, ChatGPT, and Claude
  conversations: highlight text in an answer, attach a comment thread, and
  ask a model follow-up questions inside the thread.
- Official-API backends (OpenAI, Google AI, Anthropic) with per-provider
  key + model settings; Gemini/Claude fall back to the logged-in web session
  without a key.
- Firefox and Chrome builds; functional-core/imperative-shell architecture
  with a Vitest suite.
