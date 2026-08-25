import { describe, it, expect } from "vitest";
import prompt from "../../src/core/prompt.js";

const { composePrompt } = prompt;

function thread(over = {}) {
  return Object.assign(
    {
      selector: { exact: "8 KB page" },
      section: "A B+ tree node fits in one 8 KB page because that is the OS page size.",
      messages: [{ role: "user", text: "why 8 KB and not 4 KB?" }],
    },
    over,
  );
}

describe("composePrompt — context-scope Strategy", () => {
  it("'selection' includes only the highlighted text as context", () => {
    const out = composePrompt(thread(), "selection", {});
    expect(out).toContain('"""\n8 KB page\n"""');
    expect(out).not.toContain("OS page size");
  });

  it("'section' includes the answer section", () => {
    const out = composePrompt(thread(), "section", {});
    expect(out).toContain("OS page size");
  });

  it("'section' falls back to the exact text when section is empty", () => {
    const out = composePrompt(thread({ section: "" }), "section", {});
    expect(out).toContain('"""\n8 KB page\n"""');
  });

  it("'conversation' uses the injected conversation text", () => {
    const out = composePrompt(thread(), "conversation", { conversationText: "FULL CHAT TEXT" });
    expect(out).toContain("FULL CHAT TEXT");
  });

  it("unknown scope falls back to 'section'", () => {
    const out = composePrompt(thread(), "bogus", {});
    expect(out).toContain("OS page size");
  });
});

describe("composePrompt — structure", () => {
  it("includes the highlighted phrase and the Q/A turns in order", () => {
    const out = composePrompt(
      thread({
        messages: [
          { role: "user", text: "why 8 KB?" },
          { role: "model", text: "Because the OS page is 8 KB." },
          { role: "user", text: "and 16 KB?" },
        ],
      }),
      "selection",
      {},
    );
    expect(out).toContain('I highlighted this specific part: "8 KB page"');
    expect(out.indexOf("Me: why 8 KB?")).toBeLessThan(
      out.indexOf("You: Because the OS page is 8 KB."),
    );
    expect(out.indexOf("You: Because the OS page is 8 KB.")).toBeLessThan(
      out.indexOf("Me: and 16 KB?"),
    );
  });

  it("is well-formed with no messages yet", () => {
    const out = composePrompt(thread({ messages: [] }), "selection", {});
    expect(out).toContain("Our follow-up discussion so far:");
  });

  it("preserves special characters in the text", () => {
    const out = composePrompt(thread({ selector: { exact: 'the "B+" index ☞' } }), "selection", {});
    expect(out).toContain('the "B+" index ☞');
  });
});

describe("composePrompt — provider label", () => {
  it("addresses the model by the given display name", () => {
    const out = composePrompt(thread(), "selection", {}, "Gemini");
    expect(out).toContain("I'm reading an answer you (Gemini) gave me.");
  });

  it("works for non-Gemini providers", () => {
    const out = composePrompt(thread(), "selection", {}, "ChatGPT");
    expect(out).toContain("I'm reading an answer you (ChatGPT) gave me.");
    expect(out).not.toContain("Gemini");
  });

  it("falls back to neutral wording when no label is given", () => {
    const out = composePrompt(thread(), "selection", {});
    expect(out).toContain("I'm reading an answer you gave me.");
    expect(out).not.toContain("(Gemini)");
  });
});

describe("composePrompt — error messages", () => {
  const prompt = require("../../src/core/prompt.js");
  it("skips stored error notices in the replayed discussion", () => {
    const thread = {
      selector: { exact: "8 KB page" },
      section: "context",
      messages: [
        { role: "user", text: "why?" },
        { role: "model", text: "Request timed out.", error: true },
        { role: "user", text: "why though?" },
      ],
    };
    const out = prompt.composePrompt(thread, "section");
    expect(out).toContain("Me: why?");
    expect(out).toContain("Me: why though?");
    expect(out).not.toContain("Request timed out");
  });
});

// ---- issue #8: a different provider answers ----------------------------
describe("composePrompt — cross-model asked provider", () => {
  const asked = { id: "gemini", label: "Gemini", siteId: "claude" };

  it("without `asked` the wording is unchanged (second person)", () => {
    const out = composePrompt(thread(), "section", {}, "Claude");
    expect(out).toContain("I'm reading an answer you (Claude) gave me.");
    expect(out).toContain("Me: why 8 KB and not 4 KB?");
  });

  it("names the site's model in the third person when another provider answers", () => {
    const out = composePrompt(thread(), "section", {}, "Claude", asked);
    expect(out).toContain("I'm reading an answer Claude gave me.");
    expect(out).not.toContain("you (Claude)");
  });

  it("attributes earlier replies to whoever wrote them; 'You:' only for the asked provider", () => {
    const t = thread({
      messages: [
        { role: "user", text: "q1" },
        { role: "model", text: "site reply" },
        { role: "user", text: "q2", provider: "gemini" },
        { role: "model", text: "gemini reply", provider: "gemini" },
        { role: "model", text: "gpt reply", provider: "chatgpt" },
        { role: "user", text: "q3" },
      ],
    });
    const out = composePrompt(t, "section", {}, "Claude", asked);
    expect(out).toContain(
      "Me: q1\nClaude: site reply\nMe: q2\nYou: gemini reply\nchatgpt: gpt reply\nMe: q3",
    );
  });

  it("`asked` equal to the site is the plain path", () => {
    const out = composePrompt(thread(), "section", {}, "Claude", {
      id: "claude",
      label: "Claude",
      siteId: "claude",
    });
    expect(out).toContain("you (Claude) gave me");
  });
});
