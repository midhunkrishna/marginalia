// sites.js — pure site-adapter registry: the single source of truth for "which
// AI am I on, where does its conversation id live in the URL, and which DOM
// containers hold a model answer". No DOM, no network — so it's unit-testable and
// shared by the content script. Subsumes the old core/session.js (Gemini-only).
//
// Adding a site = add an entry here + its selectors, then a backend client under
// src/<provider>/ and a manifest match. Provider id -> backend directories:
//   chatgpt -> src/openai (API)
//   gemini  -> src/gemini (web session) + src/googleai (API)
//   claude  -> src/claude (web session) + src/anthropic (API)
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.sites = (function () {
  // keyField / modelField: the settings keys (settings-schema.js) holding that
  // provider's API key and model — settings use vendor prefixes (openai,
  // anthropic) while provider ids follow the site, so the map lives here once.
  // Must agree with background/registry.js (a test pins it).
  //
  // NOTE: each provider's `hosts` are bare hostnames for providerForHost();
  // the corresponding "https://<host>/*" match patterns live in
  // src/shared/hosts.js (context menu) and, hand-synced, in both manifests'
  // content_scripts matches + host_permissions. Keep all of them in step.
  const PROVIDERS = {
    gemini: {
      label: "Gemini",
      keyField: "geminiApiKey",
      modelField: "geminiModel",
      hosts: ["gemini.google.com"],
      newChat: "https://gemini.google.com/app",
      chat: "https://gemini.google.com/app/", // + <id>; Gem chats use /gem/<gemId>/<chatId>
      // /app/<id> — matches anywhere so /u/0/app/<id> works; query/hash excluded.
      // /gem/<gemId>/<chatId> — a conversation inside a Gem; the bare Gem lobby
      // (/gem/<gemId>) is deliberately NOT a session (it's a new-chat page).
      sessionRes: [/\/app\/([^/?#]+)/, /\/gem\/([^/?#]+\/[^/?#]+)/],
      responseSelectors: [
        "message-content",
        "model-response",
        ".model-response-text",
        ".markdown",
        ".response-container-content",
      ],
      // Verified against a captured conversation: Gemini renders each turn as a
      // custom Angular element and exposes NO author-role attribute at all.
      // (`[data-message-author-role="model"]` used to sit in the list above and
      // matched exactly zero elements — copied from the ChatGPT adapter.)
      turns: { user: ["user-query"], model: ["model-response"] },
    },
    chatgpt: {
      label: "ChatGPT",
      keyField: "openaiApiKey",
      modelField: "openaiModel",
      hosts: ["chatgpt.com", "chat.openai.com"],
      newChat: "https://chatgpt.com/",
      chat: "https://chatgpt.com/c/",
      // /c/<conversation-uuid> — also matches project chats /g/g-…/c/<id>.
      sessionRes: [/\/c\/([^/?#]+)/],
      responseSelectors: ['[data-message-author-role="assistant"]', "div.markdown", ".agent-turn"],
      // Verified: every message carries data-message-author-role and a
      // data-message-id holding a server UUID. Turns do not nest.
      turns: {
        user: ['[data-message-author-role="user"]'],
        model: ['[data-message-author-role="assistant"]'],
      },
    },
    claude: {
      label: "Claude",
      keyField: "anthropicApiKey",
      modelField: "anthropicModel",
      hosts: ["claude.ai"],
      newChat: "https://claude.ai/new",
      chat: "https://claude.ai/chat/",
      // /chat/<conversation-uuid> — unanchored, so project-scoped chats
      // (/project/<projectId>/chat/<id>) resolve to the same chat id.
      sessionRes: [/\/chat\/([^/?#]+)/],
      // `.font-claude-response` is the live class. Three former trailing
      // fallbacks (.font-claude-message, [data-testid=assistant-message],
      // div.prose) were removed: they matched NOTHING on a captured
      // conversation, so they only ever cost a wasted query pass.
      responseSelectors: [".font-claude-response"],
      turns: {
        user: ['[data-testid="user-message"]'],
        model: [".font-claude-response"],
      },
    },
  };

  // Human-readable display name for a provider ("Gemini", "ChatGPT", "Claude"),
  // used e.g. when addressing the model in a composed prompt. Null when unknown.
  function providerLabel(provider) {
    const def = PROVIDERS[provider];
    return (def && def.label) || null;
  }

  // The providers a follow-up on `siteProvider` can be answered by (issue #8):
  // the site's own first (its web session, or its API when a key is set), then
  // every OTHER provider with an API key configured — a web session only works
  // on its own site. One entry means "no choice": callers hide the picker.
  //   -> [{ id, label, site: bool, model: string|null }]  (model null = web)
  function askOptions(siteProvider, settings) {
    const s = settings || {};
    const out = [];
    const site = PROVIDERS[siteProvider];
    if (site) {
      out.push({
        id: siteProvider,
        label: site.label,
        site: true,
        model: s[site.keyField] ? s[site.modelField] || null : null,
      });
    }
    for (const id in PROVIDERS) {
      if (id === siteProvider) continue;
      const def = PROVIDERS[id];
      if (!s[def.keyField]) continue;
      out.push({ id, label: def.label, site: false, model: s[def.modelField] || null });
    }
    return out;
  }

  // Provenance label for a message answered by `provider` while on
  // `siteProvider`: "Gemini" when it was someone other than the site's own
  // model, null otherwise (a missing provider stamp means the site's own).
  function viaLabel(provider, siteProvider) {
    if (!provider || provider === siteProvider) return null;
    return providerLabel(provider) || String(provider);
  }

  // The site's new-chat page — where "Start a conversation" lands. None of
  // these sites offer a programmatic create-conversation API; callers copy the
  // text and the user pastes. Null when unknown.
  function newChatUrl(provider) {
    const def = PROVIDERS[provider];
    return (def && def.newChat) || null;
  }

  // The canonical URL of an existing conversation — the inverse of
  // sessionIdFromPath, minus any account prefix (/u/0/) or project path the
  // original URL carried. Callers prefer the URL captured with the transcript
  // and fall back to this. Null for an unknown provider or empty id.
  function conversationUrl(provider, id) {
    const def = PROVIDERS[provider];
    const cid = String(id == null ? "" : id);
    if (!def || !def.chat || !cid) return null;
    if (provider === "gemini" && cid.indexOf("/") !== -1) {
      return "https://gemini.google.com/gem/" + cid.split("/").map(encodeURIComponent).join("/");
    }
    return def.chat + encodeURIComponent(cid);
  }

  // Map a hostname to a provider id. Matches the host exactly or as a subdomain
  // suffix (so www./ accounts subdomains still resolve). Returns null off-site.
  function providerForHost(hostname) {
    const h = String(hostname || "").toLowerCase();
    for (const id in PROVIDERS) {
      if (PROVIDERS[id].hosts.some((host) => h === host || h.endsWith("." + host))) return id;
    }
    return null;
  }

  // The conversation id for `provider` from a URL path (null = no chat open yet).
  // Each site lists its route patterns in order; the first match wins.
  function sessionIdFromPath(provider, pathname) {
    const def = PROVIDERS[provider];
    if (!def) return null;
    const path = String(pathname || "");
    for (const re of def.sessionRes) {
      const m = path.match(re);
      if (m) return decodeURIComponent(m[1]);
    }
    return null;
  }

  // The candidate selectors for that site's model-answer containers (a copy, so
  // callers can't mutate the registry). Empty for an unknown provider.
  function responseSelectors(provider) {
    const def = PROVIDERS[provider];
    return def ? def.responseSelectors.slice() : [];
  }

  // The site's TURN containers, split by who spoke. A thread remembers the role
  // of the turn it was created in, so a comment written on an answer can never
  // re-anchor onto a question — the single most durable signal we have, since a
  // turn's author never changes even when the site's markup does.
  //
  // These must be the OUTERMOST element per turn: the response selectors above
  // nest (on Gemini one answer matches five of them at once), and treating
  // nested matches as separate turns would read one answer as several.
  function turnSelectors(provider) {
    const def = PROVIDERS[provider];
    if (!def || !def.turns) return { user: [], model: [] };
    return { user: def.turns.user.slice(), model: def.turns.model.slice() };
  }

  // Combined selector for "any turn", for a single querySelectorAll pass.
  function turnSelector(provider) {
    const t = turnSelectors(provider);
    return t.user.concat(t.model).join(", ");
  }

  return {
    providerLabel,
    askOptions,
    viaLabel,
    newChatUrl,
    conversationUrl,
    providerForHost,
    sessionIdFromPath,
    responseSelectors,
    turnSelectors,
    turnSelector,
    PROVIDERS,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.sites;
