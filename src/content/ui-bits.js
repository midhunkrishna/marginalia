// ui-bits.js — small shared DOM leaves used by more than one surface (the
// thread box, the label chip, the panel). Extracted so the two box
// implementations can't drift: the Yes/No confirm popover, the detached badge
// + orphan toggle, the label pill/glyph, and the /label composer-intercept
// head. Pure DOM construction — each factory owns nothing beyond what it
// closes over; all styling rides the existing .ga-* classes.
var GA = (typeof GA !== "undefined" && GA) || {};

// confirmPopover({ prompt, onYes }) -> { el, show, hide }. The inline
// destructive-action confirm (same .ga-confirm CSS on every surface).
// "No" hides itself; "Yes" is the caller's — it usually destroys the host.
GA.confirmPopover = function (opts) {
  function hide() {
    el.classList.remove("ga-confirm-show");
  }
  const el = GA.el("div", { class: "ga-confirm" }, [
    GA.el("span", { text: opts.prompt }),
    GA.el("div", { class: "ga-confirm-actions" }, [
      GA.el("button", {
        class: "ga-confirm-yes",
        text: "Yes",
        onclick: function (e) {
          e.stopPropagation();
          opts.onYes();
        },
      }),
      GA.el("button", {
        class: "ga-confirm-no",
        text: "No",
        onclick: function (e) {
          e.stopPropagation();
          hide();
        },
      }),
    ]),
  ]);
  return {
    el,
    hide,
    show() {
      el.classList.add("ga-confirm-show");
    },
  };
};

// detachedBadge(className?) -> the "detached" status tag for orphaned records.
// Boxes use the default .ga-orphan-badge (their setOrphan toggles key off it);
// the panel row passes its own class.
// "via Gemini" provenance tag for a reply answered by a provider other than
// the site's own (issue #8). null when the stamp is absent or is the site's —
// callers append it only when it exists.
GA.viaTag = function (provider) {
  const label = GA.core.sites.viaLabel(provider, GA.provider);
  if (!label) return null;
  return GA.el("span", {
    class: "ga-msg-via",
    text: "via " + label,
    title: "Answered by " + label + ", not by this site's model",
  });
};

GA.detachedBadge = function (className) {
  return GA.el("span", {
    class: (className || "ga-orphan-badge") + " ga-tag",
    text: "detached",
    title: "The highlighted text no longer exists on the page",
  });
};

// makeOrphanToggle({ root, header, snippet, onChange }) -> setOrphan(bool).
// The shared ThreadBox/LabelChip behavior: toggle .ga-orphan and insert or
// remove the badge before the snippet. onChange fires only when the badge
// actually appeared/disappeared — that's when the box height changed.
GA.makeOrphanToggle = function (opts) {
  return function setOrphan(orphan) {
    opts.root.classList.toggle("ga-orphan", !!orphan);
    const badge = opts.root.querySelector(".ga-orphan-badge");
    if (orphan && !badge) {
      opts.header.insertBefore(GA.detachedBadge(), opts.snippet);
      opts.onChange && opts.onChange();
    } else if (!orphan && badge) {
      badge.remove();
      opts.onChange && opts.onChange();
    }
  };
};

// labelPill(label, { onRemove }?) -> the violet label pill. With onRemove it
// gains the small × used by the chip editor; without, it's the plain pill the
// thread box and panel render.
GA.labelPill = function (label, opts) {
  if (!(opts && opts.onRemove))
    return GA.el("span", { class: "ga-label-pill", text: label, title: label });
  return GA.el("span", { class: "ga-label-pill", title: label }, [
    // The text span must be the shrinkable flex child (min-width:0 in CSS) —
    // otherwise a long label pushes the × past the pill's clip edge and the
    // only per-label remove control becomes unclickable.
    GA.el("span", { class: "ga-label-pill-text", text: label }),
    GA.el(
      "button",
      {
        class: "ga-label-remove",
        title: 'Remove "' + label + '"',
        "aria-label": 'Remove label "' + label + '"',
        onclick: function (e) {
          e.stopPropagation();
          opts.onRemove(label);
        },
      },
      GA.icons.make("close"), // sized by .ga-label-remove svg — CSS owns it
    ),
  ]);
};

// labelGlyph({ on?, title? }) -> the tag icon span. Without `on` it stays
// CSS-hidden until a chip context reveals it (see content.css .ga-label-glyph
// rules); with `on` it's always visible.
GA.labelGlyph = function (opts) {
  const o = opts || {};
  return GA.el(
    "span",
    { class: "ga-label-glyph" + (o.on ? " ga-label-glyph-on" : ""), title: o.title || "Label" },
    GA.icons.make("tag"),
  );
};

// recordQuestionText(record) -> the one-line summary under a panel row's
// snippet: a label record lists its labels; a thread shows its first question.
GA.recordQuestionText = function (record) {
  if (record.kind === "label") {
    const labels = record.labels || [];
    return "Labeled answer" + (labels.length ? ": " + labels.join(", ") : "");
  }
  const m = (record.messages || []).find((x) => x.role === "user");
  return GA.truncate(m ? m.text : "", GA.config.PANEL_QUESTION_CHARS) || "No messages yet.";
};

// tryLabelCommand(q, thread, handlers, onApplied?) -> bool: was q the /label
// command? true means HANDLED (applied or errored+toasted) — it must not
// reach the LLM either way. Callers keep their divergent success feedback in
// onApplied (the box re-renders its pill section; the modal toasts/closes).
GA.tryLabelCommand = function (q, thread, handlers, onApplied) {
  const cmd = GA.core.labels.parseCommand(q);
  if (!cmd) return false;
  if (cmd.error) {
    GA.toast(cmd.error);
    return true;
  }
  handlers.onLabel && handlers.onLabel(thread, cmd.labels);
  onApplied && onApplied();
  return true;
};
