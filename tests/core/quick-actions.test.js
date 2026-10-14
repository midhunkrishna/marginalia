import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// quickActionsFor / sanitizeQuickActions: which chips a thread gets, and how
// stored (possibly hand-edited or corrupt) chip lists are coerced.

const GA = loadGA(["src/shared/settings-schema.js", "src/core/quick-actions.js"]);
const { quickActionsFor, sanitizeQuickActions, MAX_ACTIONS, MAX_LABEL } = GA.core.quickActions;
const DEFAULTS = GA.schema.DEFAULT_SETTINGS;

const fresh = () => ({ id: "t1", messages: [] });

describe("defaults", () => {
  it("ship Explain, ELI5, Sources?, Counter-argument with id/label/prompt", () => {
    expect(DEFAULTS.quickActions.map((a) => a.label)).toEqual([
      "Explain",
      "ELI5",
      "Sources?",
      "Counter-argument",
    ]);
    for (const a of DEFAULTS.quickActions) {
      expect(a.id && a.label && a.prompt).toBeTruthy();
    }
  });
});

describe("quickActionsFor", () => {
  it("returns the configured chips for a fresh thread", () => {
    const out = quickActionsFor(fresh(), DEFAULTS);
    expect(out.map((a) => a.id)).toEqual(DEFAULTS.quickActions.map((a) => a.id));
  });

  it("works when messages is missing", () => {
    expect(quickActionsFor({ id: "t" }, DEFAULTS)).toHaveLength(4);
  });

  it("is empty once the thread has messages", () => {
    const t = { id: "t", messages: [{ role: "user", text: "hi" }] };
    expect(quickActionsFor(t, DEFAULTS)).toEqual([]);
  });

  it("is empty for a resolved thread", () => {
    expect(quickActionsFor({ ...fresh(), resolved: true }, DEFAULTS)).toEqual([]);
  });

  it("is empty for a standalone label record", () => {
    expect(quickActionsFor({ ...fresh(), kind: "label" }, DEFAULTS)).toEqual([]);
  });

  it("is empty without a thread; falls back to defaults without settings", () => {
    expect(quickActionsFor(null, DEFAULTS)).toEqual([]);
    expect(quickActionsFor(fresh(), undefined)).toHaveLength(4);
  });

  it("honors a user list, including an emptied one", () => {
    const mine = { quickActions: [{ id: "a", label: "Jargon", prompt: "Define every term." }] };
    expect(quickActionsFor(fresh(), mine)).toEqual([
      { id: "a", label: "Jargon", prompt: "Define every term." },
    ]);
    expect(quickActionsFor(fresh(), { quickActions: [] })).toEqual([]);
  });

  it("reads {{selection}} as 'the highlighted text'", () => {
    const s = { quickActions: [{ id: "a", label: "Def", prompt: "Define {{ selection }} fully" }] };
    expect(quickActionsFor(fresh(), s)[0].prompt).toBe("Define the highlighted text fully");
  });

  it("does not hand out the shared defaults array", () => {
    const out = quickActionsFor(fresh(), DEFAULTS);
    out[0].label = "mutated";
    expect(DEFAULTS.quickActions[0].label).toBe("Explain");
  });
});

describe("sanitizeQuickActions", () => {
  it("falls back to defaults for non-arrays", () => {
    for (const bad of [undefined, null, "x", 5, {}]) {
      expect(sanitizeQuickActions(bad)).toEqual(DEFAULTS.quickActions);
    }
  });

  it("drops junk entries and entries missing a label or prompt", () => {
    const out = sanitizeQuickActions([
      null,
      "str",
      { label: "  ", prompt: "x" },
      { label: "x", prompt: "" },
      { label: 3, prompt: "x" },
      { id: "ok", label: " Good ", prompt: " do it " },
    ]);
    expect(out).toEqual([{ id: "ok", label: "Good", prompt: "do it" }]);
  });

  it("assigns unique ids to missing or duplicate ones", () => {
    const out = sanitizeQuickActions([
      { id: "a", label: "A", prompt: "p" },
      { id: "a", label: "B", prompt: "p" },
      { label: "C", prompt: "p" },
    ]);
    expect(new Set(out.map((a) => a.id)).size).toBe(3);
    expect(out[0].id).toBe("a");
  });

  it("caps count and label length", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ label: "L" + i, prompt: "p" }));
    expect(sanitizeQuickActions(many)).toHaveLength(MAX_ACTIONS);
    const long = sanitizeQuickActions([{ label: "x".repeat(100), prompt: "p" }]);
    expect(long[0].label).toHaveLength(MAX_LABEL);
  });
});
