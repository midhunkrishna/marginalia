# Marginalia features, version by version

What Marginalia can do for you, in plain language — newest first. For
install and day-to-day usage instructions, see
[`ops/using.md`](../ops/using.md).

---

## 0.5.0 — Look it up

- **No more silent breakage.** AI sites redesign their pages without warning,
  and when that happens Marginalia's highlights and buttons can quietly stop
  appearing. Now, if Marginalia can't find any answers on a conversation
  after about ten seconds, a small notice tells you the site may have
  changed, suggests checking for an extension update, and has a **Report it**
  link that opens a pre-filled bug report. It shows at most once per session
  for each site, and stays quiet on new chats and while a page is loading.
- **One-tap quick actions.** Open a comment on a highlight and the empty box
  offers four chips: **Explain**, **ELI5**, **Sources?** and
  **Counter-argument**. Tap one and the question is sent immediately — no
  typing — about the text you highlighted. It uses whatever you've set on the
  box (MD, Research, "Answer with"); when Research is on, the chips are
  tinted so you know the tap will search the web. Want to tweak the wording
  first? **Shift-click** a chip (or focus it and press **Shift+Enter**) and
  the prompt lands in the box for you to edit. The chips vanish once the
  conversation starts.
- **Make them yours.** In Settings, **Quick actions** lets you edit each
  chip's name and prompt, add new ones (say, "Jargon: define every technical
  term as a table"), reorder or remove them, and **Reset to defaults**.
  `{{selection}}` is optional in a prompt — the highlight is always what the
  question is about.
- **Research mode.** Some questions need fresh facts, not just the AI's
  memory. Flip the **Research** toggle beside the MD button, then ask: the AI
  searches the web, reads a page or two if it needs to, and you watch it
  happen — "Searching: …", "Reading: …" — right in the comment box. The
  answer arrives with little numbered citations you can click, and a
  **Sources** list at the bottom. Press Stop any time and keep what's
  written so far. The answer is saved with the thread like any other.
- **Setting it up.** In Settings:
  - tick **Use for research** on the AI provider (with an API key) you want
    doing the research — only one at a time;
  - pick a **search engine**: DuckDuckGo needs nothing, or add a Brave Search
    key for steadier results (there's a Test button);
  - optionally tick **Read web pages** — your browser will ask for permission
    to read any site; without it, research works from search results alone.
    Untick to take the permission back;
  - adjust how far a run may go: steps (8 by default), searches (5), and
    pages read (3).
- **OpenRouter.** Add an OpenRouter key and pick a model (type its name, or
  choose from the list the Test button loads). It's available from the
  **Answer with** menu on every site, and it can be your research provider.
- **Still private.** Research only happens when you turn it on for a
  question. Then your question goes to your research AI, its search queries
  to your chosen search engine, and pages are fetched without your logins.
  Nothing else, no tracking — details in [`PRIVACY.md`](../PRIVACY.md).
- **Where to get a key, and what it costs.** Each provider in Settings now has
  **Get a key** and **Pricing** links straight to the provider's own pages —
  and Google AI Studio's free tier is called out. Where you paste a key (and
  when a key fails), one line says it plainly: your keys stay in this browser
  and go only to the provider you choose, never to us.

## 0.4.1 — One question fewer

- **One-click delete for empty threads.** Deleting a thread you just opened
  no longer asks "Delete this thread?" — the confirmation appears only when
  there's something to lose (a conversation, or text you've typed but not
  sent yet).

## 0.4.0 — Built for a hundred threads

_The performance release plus a threads-panel polish pass: the same extension
made fast enough for conversations carrying 100+ comment threads, with a
calmer, roomier panel on top._

- **Checkboxes that belong.** The tick-boxes in the threads panel (labels,
  threads, matched items) now wear the extension's own look instead of the
  browser's bare native square.
- **Label groups that fold away.** In the Across-chats label picker, each
  namespace is now a little collapsible section — closed until you open it,
  already open where your picks live, and opened up by a search so results
  are never hidden behind a closed header.
- **Stretch the threads panel.** Drag any edge or corner of the panel to make
  it as wide or tall as you like — it stays put in the middle of the screen,
  and keeps your chosen size until you leave the page.

- **No more freezes.** Heavily-annotated conversations used to stutter and
  eventually hang (even on reload). The extension now does work only for
  what actually changed on the page, so streaming, scrolling, and loading
  stay smooth however much you've annotated.
- **The message box grows with you.** Type as much as you like — the input
  keeps growing (up to 40% of the window) and the comment box rises to make
  room, so everything you've typed stays visible. The Ask button also slimmed
  down to give the text more room.
- Fixes: answers streaming into a small comment box near the bottom of the
  window no longer make the box flicker while it grows; highlighting a
  passage that spans several bullets no longer disturbs the page's own
  list formatting.

## 0.3.2 — Read at your own pace

- **Calm scrolling (optional).** AI answers often arrive faster than anyone
  can read, dragging the view down with them. Turn on **Calm scrolling** in
  Settings and an arriving answer scrolls just a couple of lines and then
  holds still; a round scroll-down button marks the text piling up below.
  Click it — or scroll down yourself — to catch up and follow along again.
- **A full-width message box.** The **MD** toggle and **Ask** button moved to
  their own slim row beneath the input, so typing room is never traded for
  buttons.
- **Labels everywhere.** The full-screen view now shows and edits a thread's
  labels just like the margin box — chips, remove-×, and the pencil editor.
- Fixes: closing the full-screen view no longer squashes the margin box's
  input; the full-screen view and Across-chats panel now respect your scroll
  position while an answer streams instead of yanking to the bottom.

## 0.3.1 — A comfier place to write

- **Your half-typed message follows you.** Started writing in a margin box,
  then switched to the big full-screen view? Your text is right there,
  ready to finish. Close without sending and it's back in the margin box.
- **Send markdown when you mean to.** A little **MD** button on the message
  field lets you decide, message by message, whether what you send shows up
  formatted — code blocks, lists, headings — or as plain text. It lights up
  when it's on.
- **Code-friendly typing.** Press Enter inside an unfinished ``` code block
  and you get a new line instead of accidentally sending
  (Ctrl/Cmd + Enter always sends).
- **Stretch the input.** In the full-screen view, drag the small handle
  above the message field to make it as tall as you like — up to half the
  window. Double-click the handle to go back to automatic sizing.

## 0.3.0 — Labels & "ask across your chats"

_The organizing release: tag the answers worth keeping, then search — and
question — everything you've ever annotated, across every conversation._

- **Label anything.** Highlight part of an AI answer and tag it instead of
  (or as well as) discussing it. Click the small **tag button** on a comment
  box, or type `/label mytag` in its message field. Labels look like little
  violet tags, so they never get mixed up with your comment threads.
- **Two kinds of labels.**
  - Tag a highlight **without starting a discussion** — the comment box turns
    into a compact tag chip in the margin, marking that answer for later.
  - Or add labels **to an existing discussion thread** — they appear as small
    tags at the top of the thread.
- **Organize with dots.** Labels can have families: `project.ux` and
  `project.research` both belong to `project`. Later, picking `project`
  finds everything underneath it.
- **Edit tags anywhere, the same way.** Every tag has a little **×** to
  remove it and a field to add more. Click a tag chip (or the pencil on a
  thread) to edit.
- **The "Across chats" tab.** The threads panel (the button in the bottom
  right corner) gained a new tab that sees **all** your conversations at
  once, on that AI site:
  - Search every discussion you've ever had, by any word in it.
  - Or switch to **Labels** and pick tags — everything carrying them lines
    up, ready to check on or off.
- **Ask a question across your selection.** Pick a few discussions and
  labeled answers, then type a prompt like _"summarize these"_ or _"what
  patterns keep coming up?"_. Marginalia bundles them up, asks the AI you're
  on, and streams the answer right there in the panel. Ask follow-ups —
  earlier answers stay on screen.
- **Take the answer with you.** Two buttons under every result:
  - **Copy & open new chat** — copies the answer and opens a fresh chat on
    the site, ready for you to paste and continue.
  - **Download .md** — saves the answer as a tidy Markdown file, with a note
    of when it was made and which items went into it.

## 0.2.2 — A roomier full-screen view

- **Resize the full-screen thread view** by dragging its edges — it remembers
  your width for the rest of the visit.
- **No more missed replies.** Open a thread full-screen while an answer is
  still being written and the text flows straight in, mid-sentence.
- While a thread is full-screen, its margin box tucks itself away and comes
  back exactly as it was when you close the big view.

## 0.2.1 — Math that reads like math

- Formulas in AI answers (the `\frac{a}{b}`-style notation) now display as
  **real math symbols** — fractions, Greek letters, superscripts — instead of
  raw code, in both the margin boxes and the full-screen view.

## 0.2.0 — Your annotations, safe and portable

- **Whole conversations are kept.** Any conversation you annotate is quietly
  saved as a transcript on your computer, filling in as you scroll and
  revisit — even on sites that only show part of a long chat at a time.
- **Export for NotebookLM (or any notes app).** One click in the threads
  panel downloads the conversation **plus your comments** as a clean
  Markdown document — your annotations appear as notes right under the
  answers they were written on. It's copied to your clipboard too.
- **Backup and restore.** From the settings page, export everything —
  threads and transcripts — to a single file, and bring it back later or on
  another computer. Restoring merges safely; it never touches your settings
  or API keys.
- Sturdier storage all around: drafts aren't lost when a chat doesn't get a
  web address yet, and one damaged record can no longer hide the rest of
  your annotations.

## 0.1.1 — Finding your way around

- **Search your threads** from the panel by any word in a highlight,
  question, or answer.
- **Focus mode**: opening one thread neatly tucks the others away.
- Undo (Ctrl+Z) in the message field brings back text you deleted or sent.
- Sturdier highlight anchoring — comments find their exact sentence again
  after a reload, and refuse to guess when the page has changed too much.
- A calmer, flatter look that matches each site's colors, and the panel
  button moved to the bottom-right corner. Renamed to **Marginalia**.

## 0.1.0 — The idea

- **Comment threads in the margin** of Gemini, ChatGPT, and Claude:
  highlight any part of an answer and ask about **just that part** — the
  reply streams into a small box beside the page, and your main chat stays
  untouched.
- Threads are real conversations: ask follow-ups, minimize boxes to chips,
  resolve them when done, reopen them later. Everything is saved per
  conversation and comes back when you return.
- Works with your **logged-in session** on Gemini and Claude out of the box;
  add an API key in Settings for the official route (required for ChatGPT).
- Available for **Firefox and Chrome**.
