import { expect, open, test } from "nsh/test";
import { RICH_MAX_CHARS, RICH_MAX_LINES, RICH_MAX_TABLE_ROWS } from "../src/features/editor/EditorScreen";
import { linkTarget } from "../src/features/editor/links";
import { DOC_KEY } from "../src/store/document";

const WEB = { platform: "web" as const, width: 1280, height: 860 };
/** 存储上限（实测：键和值的字符数合计 5 MiB）。 */
const QUOTA = 5 * 1024 * 1024;

const RICH_DOC = `---
title: Demo
tags: [a, b]
---

# Demo doc

Inline math $e^{i\\pi}+1=0$ here.

$$
\\int_0^1 x\\,dx
$$

| Name | Score |
|:-----|------:|
| Ann  | 3     |
`;

test("opens with the stored Markdown and shows its text and title", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: "# Hello\n\nSome text here.\n" } });
  await app.waitFor("text:Some text here.");
  expect(app.texts()).toContain("Hello");
});

test("typed text is in the stored Markdown after a pause", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: "# Notes\n\nfirst line\n" } });
  await app.press("text:first line");
  await app.keyboard.press("end");
  await app.type("label:正文", " typed");
  await app.waitFor("text:已保存", { timeout: 3000 });
  expect(app.storage()[DOC_KEY]).toContain("first line typed");
});

test("leaving the window saves at once, without waiting for the pause", async () => {
  const app = await open("../App.tsx", { ...WEB, clock: {}, storage: { [DOC_KEY]: "# Notes\n\nfirst line\n" } });
  await app.press("text:first line");
  await app.keyboard.press("end");
  await app.type("label:正文", "!");
  await app.setLifecycle("inactive");
  await app.waitUntil(() => (app.storage()[DOC_KEY] ?? "").includes("first line!"), { timeout: 100 });
});

test("a document with front matter, math and a table reopens and stays byte for byte when nothing is edited", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: RICH_DOC } });
  await app.waitFor("text:Demo doc");
  expect(app.shows("text:Front matter · 2 行 · title: Demo")).toBe(true);
  expect(app.shows("text:Ann")).toBe(true);
  await app.wait(1200);
  await app.setLifecycle("background");
  expect(app.storage()[DOC_KEY]).toBe(RICH_DOC);
});

test("a full storage shows that the edit was not saved, and the text stays in the editor", async () => {
  const doc = "# Notes\n\nfirst line\n";
  const filler = "x".repeat(QUOTA - "filler".length - DOC_KEY.length - doc.length - 4);
  const app = await open("../App.tsx", { ...WEB, storage: { filler, [DOC_KEY]: doc } });
  await app.press("text:first line");
  await app.keyboard.press("end");
  await app.type("label:正文", " more words");
  await app.waitFor("text:本机存储已满，最近的修改没存上", { timeout: 3000 });
  expect(app.shows("text:first line more words")).toBe(true);
  expect(app.storage()[DOC_KEY]).toBe(doc);
});

const OVERSIZED: Record<string, string> = {
  "too many characters": `# Big\n\n${"word ".repeat(Math.ceil(RICH_MAX_CHARS / 5) + 1)}\n`,
  "too many short blocks": Array.from({ length: RICH_MAX_LINES + 1 }, (_, i) => `- 项 ${i}\n`).join("\n"),
  "one long table without leading pipes": `a | b\n---|---\n${Array.from({ length: RICH_MAX_TABLE_ROWS }, (_, i) => `r${i} | x`).join("\n")}\n`,
  "one long table inside a quote": `> | a | b |\n> |---|---|\n${Array.from({ length: RICH_MAX_TABLE_ROWS }, (_, i) => `> | r${i} | x |`).join("\n")}\n`,
  "too many table rows": `| a | b |\n|---|---|\n${Array.from({ length: Math.ceil(RICH_MAX_LINES / 4) }, (_, i) => `| ${i} | x |`).join("\n")}\n`,
};

for (const [name, doc] of Object.entries(OVERSIZED)) {
  test(`a document with ${name} opens as source with a notice, and stays byte for byte`, async () => {
    const app = await open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: doc } });
    await app.waitFor("id:source-notice");
    expect(app.texts().some((t) => t.includes("先用源码方式打开"))).toBe(true);
    expect(app.shows("label:正文")).toBe(false);
    await app.setLifecycle("background");
    expect(app.storage()[DOC_KEY]).toBe(doc);
  });
}

test("typing in source mode keeps the BOM and the CRLF line endings", async () => {
  const doc = `\uFEFF${Array.from({ length: RICH_MAX_LINES + 1 }, (_, i) => `- 项 ${i}`).join("\r\n\r\n")}\r\n`;
  const app = await open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: doc } });
  await app.waitFor("id:source-notice");
  await app.type("label:Markdown 源码", "Q");
  await app.setLifecycle("background");
  const stored = app.storage()[DOC_KEY] ?? "";
  expect(stored.length).toBe(doc.length + 1);
  expect(stored.startsWith("\uFEFF")).toBe(true);
  expect(stored.replace("Q", "")).toBe(doc);
});

test("Mod-2 makes the paragraph a level-2 heading in the stored Markdown", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: "# Notes\n\nalpha\n" } });
  await app.press("text:alpha");
  await app.keyboard.press("mod+2");
  await app.waitFor("text:已保存", { timeout: 3000 });
  expect(app.storage()[DOC_KEY]).toContain("## alpha");
});

test("Mod-K asks for an address and links it", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: "# Notes\n\nalpha\n" } });
  await app.press("text:alpha");
  await app.keyboard.press("end");
  await app.keyboard.press("mod+k");
  await app.waitFor("label:链接地址");
  await app.type("label:链接地址", "https://example.com/x");
  await app.press("应用");
  await app.waitFor("text:已保存", { timeout: 3000 });
  expect(app.storage()[DOC_KEY]).toContain("https://example.com/x");
});

test("Mod-click opens a web link and leaves a file: link closed", async () => {
  const doc = "# Links\n\n[site](https://example.com/a)\n\n[local](file:///etc/hosts)\n";
  const app = await open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: doc } });
  await app.waitFor("text:site");
  await app.keyboard.down("mod");
  await app.press("text:site");
  await app.press("text:local");
  await app.keyboard.up("mod");
  await app.wait(200);
  expect(app.openedUrls()).toEqual(["https://example.com/a"]);
});

test("the appearance button switches between dark and light", async () => {
  const app = await open("../App.tsx", { ...WEB, colorScheme: "light", storage: { [DOC_KEY]: "# Notes\n" } });
  await app.press("label:切换到深色外观");
  await app.waitFor("label:切换到浅色外观");
});

test("the link check opens only http, https, mailto and anchors", () => {
  expect(linkTarget("javascript:alert(1)").kind).toBe("blocked");
  expect(linkTarget(" JavaScript:alert(1)").kind).toBe("blocked");
  expect(linkTarget("file:///etc/passwd").kind).toBe("blocked");
  expect(linkTarget("data:text/html,hi").kind).toBe("blocked");
  expect(linkTarget("./other.md").kind).toBe("blocked");
  expect(linkTarget("https://example.com").kind).toBe("external");
  expect(linkTarget("HTTP://example.com").kind).toBe("external");
  expect(linkTarget("mailto:me@example.com").kind).toBe("external");
  expect(linkTarget("#intro")).toEqual({ kind: "anchor", id: "intro" });
});

test("on macOS the stored document opens, and Ctrl-Shift-` strikes text through", async () => {
  const app = await open("../App.tsx", { platform: "macos", width: 1280, height: 860, storage: { [DOC_KEY]: "# Mac\n\nbeta\n" } });
  await app.waitFor("text:beta");
  expect(app.texts()).toContain("Mac");
  await app.press("text:beta");
  await app.keyboard.press("home");
  await app.keyboard.press("shift+end");
  await app.keyboard.press("ctrl+shift+`");
  await app.waitFor("text:已保存", { timeout: 3000 });
  expect(app.storage()[DOC_KEY]).toContain("~~beta~~");
});

for (const platform of ["web", "macos"] as const) {
  test(`${platform}: typing **bold** right after Chinese text makes it bold, and the Markdown keeps the markers`, async () => {
    const app = await open("../App.tsx", { ...WEB, platform });
    await app.type("label:正文", "中文**粗体**完");
    await app.waitFor("text:已保存", { timeout: 3000 });
    expect(app.storage()[DOC_KEY]).toBe("中文**粗体**完\n");
  });

  test(`${platform}: typed punctuation is stored as typed, not swapped for typographic characters`, async () => {
    const app = await open("../App.tsx", { ...WEB, platform });
    await app.type("label:正文", 'npm i --save-dev x... "q" -> 2x3');
    await app.waitFor("text:已保存", { timeout: 3000 });
    expect(app.storage()[DOC_KEY]).toBe('npm i --save-dev x... "q" -> 2x3\n');
  });
}
