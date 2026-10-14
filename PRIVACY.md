# Marginalia — Privacy Policy

_Last updated: September 24, 2026_

Marginalia is a browser extension that adds margin comment threads to AI chat
sites (Gemini, ChatGPT, and Claude): you highlight text in an AI answer and ask
follow-up questions about it beside the page. This policy describes what data
the extension handles and where it goes.

**The short version: Marginalia has no server, no analytics, and no tracking.
Your data is stored only in your browser, and the only place anything is ever
sent is the AI service you are asking — at your request, when you ask it. The
one exception is Research mode, which you switch on per question: then the
model's search queries also go to the search engine you chose, and it may read
public web pages (see [Research mode](#research-mode)).**

## Data the extension sends

When you send a follow-up question, the extension composes a request containing:

- the text you highlighted,
- surrounding context from the AI answer (how much is controlled by the
  "context scope" setting: highlight only, the answer section, or the
  conversation),
- your question and the previous turns of that comment thread.

For an ordinary question, this request is sent to **one** destination — the
AI backend answering it:

- **Signed-in session (default for Gemini and Claude):** the request goes to
  the same site you are already using (gemini.google.com or claude.ai), through
  your existing logged-in session, exactly as if you had asked in the page
  itself.
- **Official API (when you add your own API key in Settings):** the request
  goes to that provider's API — OpenAI (`api.openai.com`), Google AI
  (`generativelanguage.googleapis.com`), Anthropic (`api.anthropic.com`), or
  OpenRouter (`openrouter.ai`) — authenticated with your key. ChatGPT
  follow-ups always use this path, and so does OpenRouter when you pick it in
  the "Answer with" menu.

Once your question reaches the AI provider, its handling is governed by **that
provider's** privacy policy and terms, the same as anything else you send to
that provider.

Apart from Research mode (below), nothing is ever sent anywhere else. There
is no first-party server, no telemetry, no error reporting, no analytics, and
no advertising or data brokerage of any kind.

## Research mode

Research mode is **off** unless you turn on the **Research** toggle in a
comment box for a particular question. Nothing below happens for ordinary
questions. When a research turn runs:

1. **The AI provider.** Your prompt and the highlighted context (the same
   request described above) go to the provider you marked **"Use for
   research"** in Settings, via its official API with your own key. This may
   be OpenRouter.
2. **The search engine.** The search queries the model writes go to the
   search engine you chose in Settings: DuckDuckGo's HTML results page
   (`html.duckduckgo.com`, no key — the default), or the Brave Search API
   (`api.search.brave.com`) with your own Brave key. Only the query text is
   sent, not your highlight or thread.
3. **Web pages (optional).** If you granted the optional "read web pages"
   permission, the extension fetches the pages the model asks to read —
   without your cookies or logins (`credentials: "omit"`) — and passes their
   text to the model. Private-network and local addresses are refused.

That is the full list: nothing goes anywhere else, and there is still no
telemetry. The "read web pages" permission (`<all_urls>`) is optional: the
extension asks for it only when you tick the box on its options page, and you
can remove it there (or in the browser's extension settings) at any time.
Without it, research answers from search results alone.

The sources a research answer cites (titles and links) are saved with the
thread, like any reply. The pages' text is not stored.

## Data the extension stores

All storage is local to your browser profile (`browser.storage.local`); none of
it is synced or uploaded:

- **Comment threads** — your questions and the AI's replies, keyed to the
  conversation they belong to, so they reappear when you reopen it.
- **Settings** — keyboard shortcut, context scope, and display preferences.
- **Optional API keys** — AI provider keys and an optional Brave Search key,
  stored locally and attached only to requests sent to the matching service.
  They are never sent anywhere else.

On gemini.google.com, signed-in mode also reads the page's own session data
(the tokens Gemini itself uses) to authenticate your request to Gemini. These
values are used only for that request and are not sent anywhere except
gemini.google.com.

## Deleting your data

- **Threads:** delete any thread from its comment box, or use **"Delete all
  saved threads"** in the extension's settings.
- **API keys:** clear the key fields in settings.
- **Page-reading permission:** untick "Read web pages" in settings.
- **Everything:** uninstalling the extension removes all of its stored data.

## What the extension does not do

- No collection of browsing history, location, health, financial, or any data
  from sites other than the three supported chat sites. (Pages fetched during
  a research turn are read only to answer that question, never stored or
  collected.)
- No selling, sharing, or transferring of data to third parties (the AI
  provider you are querying, and during a research turn the search engine you
  chose, are the intended recipients of your request, not third parties in
  this sense).
- No use of data for any purpose other than the extension's single purpose:
  answering your follow-up questions in the margin.

## Changes

If a future version changes what data is handled, this policy will be updated
here, and the change will be visible in the repository's history.

## Contact

Questions about this policy: open an issue at
<https://github.com/midhunkrishna/marginalia/issues> or email
<extensions.by.midhun@gmail.com>.
