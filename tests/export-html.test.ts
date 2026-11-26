import { expect, test } from "nsh/test";
import { phrase } from "../src/i18n";
import { markdownToHtml, markdownToHtmlWithImages } from "../src/features/files/export-html";

const body = (html: string) => html.slice(html.indexOf('<main class="doc">'), html.indexOf("</main>"));

test("text, attributes and raw HTML are escaped: the exported page carries no markup of the document's own", () => {
  const html = markdownToHtml(
    [
      "# Hi <img src=x onerror=alert(1)>",
      "",
      "Para with <b onmouseover=\"alert(1)\">inline html</b> & <script>alert(2)</script>.",
      "",
      "<div onclick=\"alert(3)\">block html</div>",
      "",
      "[q](https://x.com/\"onmouseover=\"alert(4)) ![a\"b](https://x.com/i.png \"t'\")",
      "",
    ].join("\n"),
  );
  const main = body(html);
  expect(html.includes("<script")).toBe(false);
  expect(main.includes("<b ")).toBe(false);
  expect(main.includes("<div onclick")).toBe(false);
  expect(main.includes("<img src=x")).toBe(false);
  expect(main).toContain("&lt;div onclick=&quot;alert(3)&quot;&gt;block html&lt;/div&gt;");
  expect(main).toContain("&lt;script&gt;");
  expect(main).toContain('alt="a&quot;b"');
  expect(main).toContain('title="t&#39;"');
  expect(html).toContain("Content-Security-Policy");
  expect(html).toContain("<title>Hi &lt;img src=x onerror=alert(1)&gt;</title>");
});

test("links keep only http, https, mailto and in-document anchors; other schemes lose their href", () => {
  const main = body(
    markdownToHtml("# Top\n\n[w](https://example.com/a?b=1&c=2) [m](mailto:a@b.c) [t](#top) [j](javascript:alert(1)) [f](file:///etc/passwd) [r](notes.md)\n\n![x](javascript:alert(1)) ![y](https://example.com/y.png)\n"),
  );
  expect(main).toContain('<a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">w</a>');
  expect(main).toContain('<a href="mailto:a@b.c" rel="noopener noreferrer">m</a>');
  expect(main).toContain('<a href="#top">t</a>');
  expect(main).toContain("<a>j</a>");
  expect(main).toContain("<a>f</a>");
  expect(main).toContain("<a>r</a>");
  expect(main.includes("javascript:")).toBe(false);
  expect(main.includes("file:")).toBe(false);
  expect(main).toContain('<img src="https://example.com/y.png" alt="y" loading="lazy">');
});

test("headings get anchors the table of contents links to; lists, tasks, tables, code, quotes and alerts come out as their HTML", () => {
  const md = [
    "---",
    "title: hidden",
    "---",
    "",
    "[toc]",
    "",
    "# Plan",
    "",
    "## Plan",
    "",
    "- a",
    "- b",
    "",
    "1. one",
    "",
    "- [x] done",
    "- [ ] todo",
    "",
    "| L | C | R |",
    "| :-- | :-: | --: |",
    "| 1 | **2** | `3` |",
    "",
    "```js",
    "if (a < b) {}",
    "```",
    "",
    "> quoted",
    "",
    "> [!WARNING]",
    "> careful",
    "",
    "[ref]: https://example.com",
    "",
  ].join("\n");
  const main = body(markdownToHtml(md));
  expect(main.includes("title: hidden")).toBe(false);
  expect(main.includes("[ref]:")).toBe(false);
  expect(main).toContain('<h1 id="plan">Plan</h1>');
  expect(main).toContain('<h2 id="plan-1">Plan</h2>');
  expect(main).toContain('<li class="toc-1"><a href="#plan">Plan</a></li><li class="toc-2"><a href="#plan-1">Plan</a></li>');
  expect(main).toContain("<li><p>a</p></li><li><p>b</p></li>");
  expect(main).toContain('<ul class="list tasks"><li class="task"><input type="checkbox" disabled checked> <p>done</p></li><li class="task"><input type="checkbox" disabled> <p>todo</p></li></ul>');
  expect(main).toContain('<th style="text-align:left">L</th><th style="text-align:center">C</th><th style="text-align:right">R</th>');
  expect(main).toContain('<td style="text-align:center"><strong>2</strong></td><td style="text-align:right"><code>3</code></td>');
  expect(main).toContain('<pre><code class="language-js">if (a &lt; b) {}</code></pre>');
  expect(main).toContain("<blockquote><p>quoted</p></blockquote>");
  expect(main).toContain('<div class="alert alert-warning"><p class="alert-title">Warning</p><p>careful</p></div>');
});

test("formulas keep their TeX, Mermaid keeps its source, footnotes gather at the end with links both ways", () => {
  const md = "Energy $E=mc^2$ here[^n].\n\n$$\n\\int_0^1 x\\,dx < 1\n$$\n\n```mermaid\ngraph TD; A-->B\n```\n\n[^n]: The note <i>x</i>.\n";
  const main = body(markdownToHtml(md));
  expect(main).toContain("$E=mc^2$");
  expect(main).toContain("\\int_0^1 x\\,dx &lt; 1");
  expect(main).toContain("Formula (TeX source)");
  expect(main).toContain("graph TD; A--&gt;B");
  expect(main).toContain("Mermaid diagram");
  expect(main).toContain('<sup class="fnref"><a href="#fn:n" id="fnref:n">n</a></sup>');
  expect(main).toContain('<li id="fn:n"><span class="fnlabel">n</span> The note <em>x</em>. <a class="fnback" href="#fnref:n" aria-label="Return to text">↩</a></li>');
});

test("a run of HTML comments followed by text exports quickly as source; comments alone are dropped", () => {
  const t = Date.now();
  const main = body(markdownToHtml(`${"<!--a-->".repeat(26)}x\n\n<!-- one --> <!-- two -->\n`));
  expect(Date.now() - t).toBeLessThan(1800);
  expect(main).toContain("&lt;!--a--&gt;x");
  expect(main.includes("one")).toBe(false);
});

test("images: blob addresses and schemes hidden behind tabs or newlines are not written out; web images still load", () => {
  const main = body(markdownToHtml("![b](blob:https://x/1) ![j](java&#9;script:alert(1)) ![w](https://example.com/w.png)\n\n[l](java&#10;script:alert(1))\n"));
  expect(main).toContain('<span class="missing">[b]</span>');
  expect(main).toContain('<span class="missing">[j]</span>');
  expect(main.includes("blob:")).toBe(false);
  expect(main.includes("script:")).toBe(false);
  expect(main).toContain('<img src="https://example.com/w.png" alt="w" loading="lazy">');
  expect(main).toContain("<a>l</a>");
});

test("footnote ids cannot collide with heading ids, and a footnote's own Markdown is formatted", () => {
  const main = body(markdownToHtml("# fn n\n\nSee[^n].\n\n[^n]: **bold** and [a](https://x.y)\n"));
  expect(main).toContain('<h1 id="fn-n">fn n</h1>');
  expect(main).toContain('<li id="fn:n">');
  expect(main).toContain('<strong>bold</strong> and <a href="https://x.y" rel="noopener noreferrer">a</a>');
});

test("diagrams that could not be drawn are exported as source and the receipt says how many", async () => {
  const doc = "# 图\n\n```mermaid\ngraph TD; A-->B\n```\n\n```mermaid\ngraph TD; A-->B\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n";
  const out = await markdownToHtmlWithImages(doc, null);
  expect(phrase(out.note)).toBe("Could not render 3 Mermaid diagrams. Exported the source text instead.");
  expect(body(out.html)).toContain("graph TD; A--&gt;B");
  expect(out.html.includes("<img")).toBe(false);
});
