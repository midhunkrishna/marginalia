// transcript.js — pure Markdown renderer for a captured conversation + its
// threads. Takes the DECOMPRESSED convo record (the export path in T-012 is
// the sole decompress site) plus that conversation's thread array, and returns
// a NotebookLM/Obsidian-ready Markdown string. No DOM, no storage, no
// CompressionStream — build ONLY strings, never HTML.
//
// Two jobs beyond layout:
//  - PREFIX-DEDUPE (fix F3): capture-on-create can store a mid-stream partial
//    of an answer that a later capture stores completed. Consecutive same-role
//    turns where one normalized text is a strict prefix of the other render
//    only the LONGER. Regenerated (non-prefix) answers are a documented
//    limitation — both render; dropping a "maybe duplicate" would silently
//    lose real content, which is worse than the duplicate it cleans.
//  - Thread placement: a thread lands after the turn whose fp matches its
//    recorded anchor fingerprint (FIRST matching turn — duplicate fps are
//    expected for repeated identical messages). A miss (the anchor points at
//    a dropped/upgraded mid-stream fp) falls back to quote containment —
//    first same-role turn whose text contains the quoted exact. Still no
//    match (legacy null anchor, quote nowhere on record) routes it to a
//    trailing "Unanchored notes" section — never silently lost. A hash
//    collision is documented-safe in turn-id.js for anchoring; here it could
//    at worst file a note under a same-length twin turn, never lose it.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.transcript = (function () {
  function norm(text) {
    return GA.core.turnId.normalize(text);
  }

  // ---- text hygiene ---------------------------------------------------
  // Captured text must not smuggle raw HTML or fake document structure into
  // the Markdown. `<` is backslash-escaped (CommonMark renders `\<` as a
  // literal, so `<script>` can never pass through as markup), and a line that
  // would open a heading or a blockquote gets its marker escaped so turn text
  // cannot forge sections or nest into our callouts.
  function mdBlock(text) {
    return String(text == null ? "" : text)
      .replace(/\r\n?/g, "\n")
      .replace(/</g, "\\<")
      .replace(/^([ \t]{0,3})([#>])/gm, "$1\\$2");
  }

  // Single-line fields (title, quote, metadata): collapse whitespace first so
  // a stray newline can't break out of the heading or list item.
  function mdInline(text) {
    return mdBlock(norm(text));
  }

  // Prefix every line with "> " so multi-line thread content stays inside its
  // blockquote callout.
  function quote(text) {
    return text
      .split("\n")
      .map((l) => (l ? "> " + l : ">"))
      .join("\n");
  }

  // Pure: formats the RECORDED capture time, never reads the clock. UTC so
  // the same record renders identically everywhere.
  function formatDate(ts) {
    if (ts == null) return null;
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }

  // ---- turns ------------------------------------------------------------
  // Turn ordering, prefix-dedupe (fix F3) and thread placement are shared
  // with the Outline tab and the bundle prompt — see core/outline.js.
  function headingFor(role) {
    return GA.core.outline.ROLE_LABEL[role] || "Message";
  }

  // ---- threads ------------------------------------------------------------
  // A reply stamped with a provider (issue #8: answered by a model the user
  // picked, not the site's own) names it — the export has no site context, so
  // every stamp shows. Unknown ids render as recorded.
  function speakerFor(role, provider) {
    if (role === "user") return "You";
    if (role !== "model") return "Note";
    if (!provider) return "Assistant";
    const label = GA.core.sites.providerLabel(provider) || String(provider);
    return "Assistant (" + mdInline(label) + ")";
  }

  function calloutFor(thread) {
    const parts = [];
    const exact = thread && thread.selector ? thread.selector.exact : null;
    parts.push(norm(exact) ? '"' + mdInline(exact) + '"' : "_(no highlighted text recorded)_");
    const labels = thread && Array.isArray(thread.labels) ? thread.labels.filter(Boolean) : [];
    if (labels.length) parts.push("**Labels:** " + labels.map(mdInline).join(", "));
    const msgs = thread && Array.isArray(thread.messages) ? thread.messages : [];
    for (const raw of msgs) {
      const m = raw && typeof raw === "object" ? raw : {};
      parts.push("**" + speakerFor(m.role, m.provider) + ":** " + mdBlock(m.text));
    }
    return quote("[!note] Annotation\n" + parts.join("\n\n"));
  }

  // ---- document -----------------------------------------------------------
  function build(convo, threads) {
    const record = convo && typeof convo === "object" ? convo : {};
    const outline = GA.core.outline;
    const turns = outline.dedupeTurns(outline.sortedTurns(record));
    const ordered = outline.orderedThreads(threads);

    // Attach each thread to the FIRST surviving turn whose fp matches its
    // recorded anchor fingerprint (quote containment as the stale-anchor
    // fallback); everything else trails as unanchored.
    const byTurn = new Map();
    const unanchored = [];
    for (const th of ordered) {
      const at = outline.locateThread(th, turns);
      if (at === -1) {
        unanchored.push(th);
      } else {
        if (!byTurn.has(at)) byTurn.set(at, []);
        byTurn.get(at).push(th);
      }
    }

    const out = [];
    out.push("# " + (mdInline(record.title) || "Captured conversation"));
    out.push("");
    // Framing (brief ruling): this is a CAPTURED transcript — the turns saved
    // while annotating — never a claim of full-conversation fidelity.
    out.push(
      "*Captured transcript — the turns saved while annotating this conversation; it may not span the full exchange.*",
    );
    out.push("");
    const meta = [];
    if (norm(record.provider)) meta.push("- Provider: " + mdInline(record.provider));
    const when = formatDate(record.capturedAt);
    if (when) meta.push("- Captured: " + when);
    if (norm(record.url)) meta.push("- Source: " + mdInline(record.url));
    if (meta.length) {
      out.push(meta.join("\n"));
      out.push("");
    }
    out.push("---");
    out.push("");

    for (let k = 0; k < turns.length; k++) {
      out.push("## " + headingFor(turns[k].role));
      out.push("");
      if (norm(turns[k].text)) {
        out.push(mdBlock(turns[k].text));
        out.push("");
      }
      const anns = byTurn.get(k) || [];
      for (const ann of anns) {
        out.push(calloutFor(ann));
        out.push("");
      }
    }

    if (unanchored.length) {
      out.push("## Unanchored notes");
      out.push("");
      for (const un of unanchored) {
        out.push(calloutFor(un));
        out.push("");
      }
    }

    return (
      out
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim() + "\n"
    );
  }

  return { build };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.transcript;
