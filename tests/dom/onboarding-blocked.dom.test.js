// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { loadGA } from "../helpers/loadGA.js";

// Blocked-injection help page: the affected host arrives in the query string
// (attacker-influenceable, since anyone can link to the page), so it must land
// in the DOM as text — never as markup.

function setup(search) {
  document.body.innerHTML = fs
    .readFileSync("src/onboarding/blocked.html", "utf8")
    .replace(/[\s\S]*<body>/, "")
    .replace(/<script[\s\S]*$/, "");
  const GA = loadGA(["src/onboarding/blocked.js"], {});
  GA.blocked.init(search);
  return { GA, hosts: [...document.querySelectorAll("[data-host]")] };
}

describe("blocked-injection help page", () => {
  it("renders the host from the query param into every host slot", () => {
    const { hosts } = setup("?host=gemini.google.com");
    expect(hosts.length).toBeGreaterThan(0);
    for (const el of hosts) expect(el.textContent).toBe("gemini.google.com");
  });

  it("treats a hostile host value as text, not markup", () => {
    const evil = '<img src=x onerror="window.pwned=1"><b>x</b>';
    const { hosts } = setup("?host=" + encodeURIComponent(evil));
    for (const el of hosts) {
      expect(el.textContent).toBe(evil);
      expect(el.querySelector("img, b")).toBeNull();
    }
    expect(document.querySelector("img[onerror]")).toBeNull();
  });

  it("falls back to generic wording when the host is missing or oversized", () => {
    const { GA } = setup("");
    expect(GA.blocked.readHost("")).toBe("");
    expect(GA.blocked.readHost("?host=" + "a".repeat(400))).toBe("");
    for (const el of document.querySelectorAll("[data-host]"))
      expect(el.textContent).toBe("this site");
  });
});
