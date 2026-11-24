import { expect, open, test } from "nsh/test";
import { DOC_KEY } from "../src/store/document";

const WEB = { platform: "web" as const, width: 1280, height: 860 };

const openDoc = (doc: string) => open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: doc } });
type App = Awaited<ReturnType<typeof openDoc>>;

async function saved(app: App): Promise<string> {
  await app.setLifecycle("background");
  return app.storage()[DOC_KEY] ?? "";
}

test("a document can be written with only the slash menu: heading, then a table", async () => {
  const app = await openDoc("");
  await app.type("label:正文", "/");
  await app.waitFor("id:slash-menu");
  await app.type("label:正文", "bt2");
  await app.keyboard.press("enter");
  await app.type("label:正文", "Plan");
  await app.keyboard.press("enter");
  await app.type("label:正文", "/table");
  await app.waitFor("id:slash-block.table");
  await app.keyboard.press("enter");
  await app.waitFor("id:table-bar");
  const md = await saved(app);
  expect(md.startsWith("## Plan\n")).toBe(true);
  expect(md).toContain("| --- |");
});

test("Escape closes the slash menu and leaves the slash typed", async () => {
  const app = await openDoc("");
  await app.type("label:正文", "/");
  await app.waitFor("id:slash-menu");
  await app.keyboard.press("escape");
  await app.wait(300);
  expect(app.shows("id:slash-menu")).toBe(false);
  expect(await saved(app)).toBe("/\n");
});

test("the command palette runs a block command and jumps to a heading", async () => {
  const app = await openDoc("# Title\n\nalpha\n\n## Second\n\nbeta\n");
  await app.press("text:alpha");
  await app.keyboard.press("mod+shift+p");
  await app.waitFor("id:palette");
  await app.type("label:命令", "wxlb");
  await app.keyboard.press("enter");
  await app.waitUntil(() => !app.shows("id:palette"), { timeout: 3000 });
  await app.keyboard.press("mod+shift+p");
  await app.waitFor("id:palette");
  await app.type("label:命令", "Second");
  await app.keyboard.press("enter");
  await app.waitUntil(() => !app.shows("id:palette"), { timeout: 3000 });
  await app.type("label:正文", "X");
  const md = await saved(app);
  expect(md).toContain("- alpha");
  expect(md).toContain("## XSecond");
});

const ODD = "Setext\r\n======\r\n\r\n* star\r\n* two\r\n\r\ntext\r\n";

test("opening and closing the source view without edits keeps the bytes", async () => {
  const app = await openDoc(ODD);
  await app.waitFor("text:star");
  await app.keyboard.press("mod+alt+/");
  await app.waitFor("label:Markdown 源码");
  await app.press("id:toggle-source");
  await app.waitFor("label:正文");
  await app.wait(1200);
  expect(await saved(app)).toBe(ODD);
});

test("an edit in the source view reaches the document and only rewrites its own block", async () => {
  const app = await openDoc(ODD);
  await app.waitFor("text:star");
  await app.press("text:text");
  await app.keyboard.press("mod+alt+/");
  await app.waitFor("label:Markdown 源码");
  await app.type("label:Markdown 源码", "new ");
  await app.press("id:toggle-source");
  await app.waitFor("text:new text");
  expect(await saved(app)).toBe("Setext\r\n======\r\n\r\n* star\r\n* two\r\n\r\nnew text\r\n");
});

test("find counts matches, and replace all changes every one", async () => {
  const app = await openDoc("# Notes\n\nalpha beta Alpha\n\nalphabet\n");
  await app.press("text:Notes");
  await app.keyboard.press("mod+alt+f");
  await app.waitFor("id:find-bar");
  await app.type("label:查找内容", "alpha");
  await app.waitFor("text:3 处");
  await app.press("label:整词匹配");
  await app.waitFor("text:2 处");
  await app.type("label:替换成", "omega");
  await app.press("全部替换");
  await app.waitFor("text:无结果");
  expect(await saved(app)).toBe("# Notes\n\nomega beta omega\n\nalphabet\n");
});

test("Escape closes the find bar", async () => {
  const app = await openDoc("# Notes\n\nalpha\n");
  await app.press("text:alpha");
  await app.keyboard.press("mod+f");
  await app.waitFor("id:find-bar");
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:find-bar"), { timeout: 1000 });
});

test("the outline lists the headings and jumps to one", async () => {
  const app = await openDoc("# One\n\ntext\n\n## Two\n\nmore\n");
  await app.press("text:text");
  await app.keyboard.press("mod+shift+l");
  await app.waitFor("id:outline");
  await app.press("id:outline-1");
  await app.type("label:正文", "Z");
  expect(await saved(app)).toContain("## ZTwo");
  await app.keyboard.press("mod+shift+l");
  await app.waitUntil(() => !app.shows("id:outline"), { timeout: 1000 });
});

test("in a table, Mod-Enter adds a row and Mod-Shift-Backspace deletes it", async () => {
  const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
  const app = await openDoc(doc);
  await app.press("text:1");
  await app.keyboard.press("mod+enter");
  await app.wait(300);
  expect((await saved(app)).split("\n").filter((l) => l.startsWith("|")).length).toBe(4);
  await app.setLifecycle("active");
  await app.keyboard.press("mod+shift+backspace");
  await app.wait(300);
  expect((await saved(app)).split("\n").filter((l) => l.startsWith("|")).length).toBe(3);
});

test("selecting text shows the format bar, and its bold button bolds the selection", async () => {
  const app = await openDoc("# Notes\n\nalpha beta\n");
  await app.press("text:alpha beta");
  await app.keyboard.press("home");
  await app.keyboard.press("shift+end");
  await app.waitFor("id:format-bar");
  await app.waitFor("text:选中 2 词 · 10 字符");
  await app.press("id:bar-bold");
  expect(await saved(app)).toBe("# Notes\n\n**alpha beta**\n");
});

test("a selected formula can be edited from its bar", async () => {
  const app = await openDoc("# M\n\n$$\nx^2\n$$\n");
  await app.press("text:x^2");
  await app.waitFor("id:atom-bar");
  await app.press("label:编辑源码");
  await app.waitFor("id:atom-prompt");
  await app.type("label:公式块（LaTeX）", "+1");
  await app.press("应用");
  expect(await saved(app)).toBe("# M\n\n$$\nx^2+1\n$$\n");
});

test("the block menu turns a paragraph into a heading", async () => {
  const app = await openDoc("# Notes\n\nalpha\n");
  await app.hover("text:alpha");
  await app.waitFor("id:block-handle");
  await app.press("id:block-handle");
  await app.waitFor("id:block-menu");
  await app.press("id:block-menu-block.h3");
  expect(await saved(app)).toBe("# Notes\n\n### alpha\n");
});

test("jumping from the outline right after an edit lands on the heading", async () => {
  const app = await openDoc("# One\n\ntext\n\n## Two\n\nmore\n");
  await app.press("text:text");
  await app.keyboard.press("mod+shift+l");
  await app.waitFor("id:outline");
  await app.press("text:text");
  await app.keyboard.press("mod+alt+u");
  await app.press("id:outline-1");
  await app.type("label:正文", "Z");
  expect(await saved(app)).toContain("## ZTwo");
});

test("the block menu's heading choice keeps a heading that is already at that level", async () => {
  const app = await openDoc("# Notes\n\nalpha\n");
  await app.hover("id:editor >> text:Notes");
  await app.waitFor("id:block-handle");
  await app.press("id:block-handle");
  await app.waitFor("id:block-menu");
  await app.press("id:block-menu-block.h1");
  await app.wait(300);
  expect(await saved(app)).toBe("# Notes\n\nalpha\n");
});

test("regex replace all with a lookahead replaces only where the lookahead holds", async () => {
  const app = await openDoc("# R\n\nfoobar foobaz\n");
  await app.press("text:R");
  await app.keyboard.press("mod+alt+f");
  await app.waitFor("id:find-bar");
  await app.press("label:正则表达式");
  await app.type("label:查找内容", "foo(?=bar)");
  await app.waitFor("text:1 处");
  await app.type("label:替换成", "X");
  await app.press("全部替换");
  await app.waitFor("text:无结果");
  expect(await saved(app)).toBe("# R\n\nXbar foobaz\n");
});

test("replace all changes matches past the 2000 highlight cap in one go", async () => {
  const app = await openDoc(`# Many\n\n${"a ".repeat(2100).trim()}\n`);
  await app.press("text:Many");
  await app.keyboard.press("mod+alt+f");
  await app.waitFor("id:find-bar");
  await app.press("label:整词匹配");
  await app.type("label:查找内容", "a");
  await app.waitFor("text:2000+ 处");
  await app.type("label:替换成", "b");
  await app.press("全部替换");
  await app.waitFor("text:无结果");
  expect(await saved(app)).toBe(`# Many\n\n${"b ".repeat(2100).trim()}\n`);
});

test("the top bar follows edits made in the source view", async () => {
  const app = await openDoc("# Notes\n\nalpha\n");
  await app.press("text:Notes");
  await app.keyboard.press("mod+alt+/");
  await app.waitFor("label:Markdown 源码");
  await app.type("label:Markdown 源码", "x");
  await app.waitUntil(() => app.texts().some((t) => t.endsWith("字符") && !t.includes("词")), { timeout: 2000 });
  await app.press("id:toggle-source");
  await app.waitFor("label:正文");
  await app.waitUntil(() => app.texts().some((t) => / 词 · /.test(t)), { timeout: 2000 });
});

test("editing the document closes an open formula edit box without applying it", async () => {
  const app = await openDoc("# M\n\nalpha\n\n$$\nx^2\n$$\n");
  await app.press("text:x^2");
  await app.press("label:编辑源码");
  await app.waitFor("id:atom-prompt");
  await app.type("label:公式块（LaTeX）", "+1");
  await app.press("text:alpha");
  await app.type("label:正文", "Z");
  await app.waitUntil(() => !app.shows("id:atom-prompt"), { timeout: 1000 });
  const md = await saved(app);
  expect(md).toContain("x^2\n$$");
  expect(md).toContain("Z");
});
