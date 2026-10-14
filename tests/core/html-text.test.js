import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import htmlText from "../../src/core/html-text.js";

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const read = (f) => fs.readFileSync(path.join(FIX, f), "utf8");
const { extract, stripTags, decodeEntities, collapseWhitespace } = htmlText;

describe("htmlText.decodeEntities", () => {
  it("decodes named, decimal and hex entities in one pass", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#x27; &mdash;&hellip;")).toBe(
      "a & b <c> \"d\" 'e' —…",
    );
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeEntities("&#128512; &#x1F600;")).toBe("😀 😀");
  });

  it("leaves unknown names and maps invalid code points to U+FFFD", () => {
    expect(decodeEntities("&bogus; &#0; &#xD800; &#x110000;")).toBe("&bogus; � � �");
    expect(decodeEntities(null)).toBe("");
  });
});

describe("htmlText.stripTags / collapseWhitespace", () => {
  it("strips tags and comments but keeps a bare '<' in text", () => {
    expect(stripTags("<p class=x>a <b>b</b></p><!-- c --> 1 < 2")).toBe("a b 1 < 2");
  });

  it("collapses spaces, keeps tabs, caps blank lines", () => {
    expect(collapseWhitespace("  a   b \r\n\n\n\n c \t  d  \n")).toBe("a b\n\nc\td");
  });
});

describe("htmlText.extract", () => {
  it("extracts title and main-article text from a realistic page", () => {
    const { title, text, truncated } = extract(read("article-page.html"));
    expect(title).toBe("How Tides Work & Why — Ocean Notes");
    expect(truncated).toBe(false);
    expect(text).toBe(
      [
        "How Tides Work",
        "",
        "Tides are caused by the Moon's gravity and the Sun’s.",
        "",
        "There are two high tides a day—usually.",
        "",
        "- Spring tides",
        "- Neap tides",
        "",
        "Place\tRange",
        "Bay of Fundy\t16 m",
        "",
        "5 < 6 && 7 > 3 &lt;tag&gt; © &unknown; �",
      ].join("\n"),
    );
    for (const junk of [
      "not text",
      "hidden",
      "Home",
      "Breadcrumbs",
      "Share icons",
      "svg label",
      "inner svg",
      "Subscribe",
      "Enable JS",
      "Related",
      "Copyright",
      "tagline",
    ])
      expect(text).not.toContain(junk);
  });

  it("falls back to #content, then body", () => {
    expect(extract(read("plain-body.html")).text).toBe("Main content paragraph.");
    expect(extract("<body><p>Only body</p><footer>f</footer></body>").text).toBe("Only body");
    expect(extract("no markup at all").text).toBe("no markup at all");
    expect(extract("").text).toBe("");
  });

  it("prefers role=main over body and skips an empty <main>", () => {
    const html = '<body><main></main><p>x</p><div role="main"><p>Real</p></div></body>';
    expect(extract(html).text).toBe("Real");
  });

  it("removes nested same-tag hidden blocks to their matching close", () => {
    const html =
      '<main><div aria-hidden="true"><div>a</div><div>b</div></div><p>keep</p>' +
      "<nav><nav>x</nav>y</nav><p>tail</p></main>";
    expect(extract(html).text).toBe("keep\n\ntail");
  });

  it("an unclosed dropped element loses only its opener", () => {
    expect(extract("<main><aside>side<p>body</p></main>").text).toBe("side\n\nbody");
  });

  it("keeps <pre> line breaks and pulls list text onto its bullet", () => {
    expect(extract("<ul><li><p>a</p></li></ul><pre>x\ny</pre>").text).toBe("- a\n\nx\ny");
  });

  it("caps on a line boundary and marks truncation", () => {
    const html =
      "<main>" +
      ["one", "two", "three", "four"].map((w) => "<p>" + w + "</p>").join("") +
      "</main>";
    const out = extract(html, { maxChars: 12 });
    expect(out.truncated).toBe(true);
    expect(out.text).toBe("one\n\ntwo\n…[truncated]");
    const long = extract("<p>" + "x".repeat(50) + "</p>", { maxChars: 20 });
    expect(long.text).toBe("x".repeat(20) + "\n…[truncated]");
    expect(extract(html, { maxChars: 1000 }).truncated).toBe(false);
  });
});
