import { expect, open, test } from "nsh/test";
// 旧版（单篇）的正文键：存进去的那篇启动时原地成为文档库的第一篇，测试照旧在这里读写
import { LEGACY_DOC_KEY as DOC_KEY } from "../src/store/kv";

const WEB = { platform: "web" as const, width: 1280, height: 860 };
const BODY = "label:正文";

const openDoc = (doc: string) => open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: doc } });
type App = Awaited<ReturnType<typeof openDoc>>;

async function saved(app: App): Promise<string> {
  await app.setLifecycle("background");
  return app.storage()[DOC_KEY] ?? "";
}

/** 一个字一个字地打，和人打字一样：转换只在「刚打了一个字」时发生。 */
async function typeEach(app: App, text: string) {
  for (const ch of text) await app.type(BODY, ch);
}

test("typing `- [ ] ` starts a task item", async () => {
  const app = await openDoc("");
  await typeEach(app, "- [ ] buy milk");
  expect(await saved(app)).toBe("- [ ] buy milk\n");
});

test("typing `[text](url)` makes a link, and what follows is not part of it", async () => {
  const app = await openDoc("");
  await typeEach(app, "see [docs](https://example.com/a) now");
  expect(await saved(app)).toBe("see [docs](https://example.com/a) now\n");
});

test("typing `$$` and Enter opens the formula box instead of leaving literal dollars", async () => {
  const app = await openDoc("");
  await typeEach(app, "$$");
  await app.keyboard.press("enter");
  await app.waitFor("id:atom-prompt");
  await app.type("label:公式块（LaTeX）", "E=mc^2");
  await app.press("text:应用");
  await app.waitUntil(() => !app.shows("id:atom-prompt"), { timeout: 3000 });
  expect(await saved(app)).toBe("$$\nE=mc^2\n$$\n");
});

test("text typed after inline code at the end of a paragraph is not code", async () => {
  const app = await openDoc("ends with `tail`\n");
  await app.waitFor("text:ends with tail");
  // 光标挪到行尾，也就是紧挨着行内代码的右边
  await app.keyboard.press("end");
  await typeEach(app, " out");
  expect(await saved(app)).toBe("ends with `tail` out\n");
});

const PASTED = "# Guide\n\nSome **bold** and `code` and [a link](https://example.com).\n\n- one\n- two\n\n| Key | Does |\n| --- | --- |\n| B | bold |\n";

test("pasted Markdown text is read as Markdown, not as literal lines", async () => {
  const app = await openDoc("");
  await app.paste(BODY, { text: PASTED });
  await app.waitFor("text:Guide");
  expect(await saved(app)).toBe(PASTED);
});

test("pasted plain lines stay plain", async () => {
  const app = await openDoc("");
  await app.paste(BODY, { text: "first line\nsecond line" });
  await app.waitFor("text:second line");
  expect(await saved(app)).toBe("first line\n\nsecond line\n");
});

test("the same key enters and leaves the source view", async () => {
  const app = await openDoc("# Title\n\nbody\n");
  await app.press("text:body");
  await app.keyboard.press("mod+alt+/");
  await app.waitFor("label:Markdown 源码");
  await app.keyboard.press("mod+alt+/");
  await app.waitUntil(() => !app.shows("label:Markdown 源码"), { timeout: 3000 });
});

test("stepping through matches does not pop the format bar over the text", async () => {
  const app = await openDoc("alpha beta alpha\n");
  await app.press("text:alpha beta alpha");
  await app.keyboard.press("mod+f");
  await app.waitFor("id:find-bar");
  await app.type("label:查找内容", "alpha");
  await app.keyboard.press("enter");
  await app.wait(400);
  expect(app.shows("id:format-bar")).toBe(false);
});

test("deleting next to an escaped literal `[a](b)` does not turn it into a link", async () => {
  const src = "\\[a](b)\n\nnext\n";
  const app = await openDoc(src);
  await app.waitFor("text:next");
  await app.keyboard.press("end");
  await app.keyboard.press("arrowleft");
  await app.keyboard.press("arrowright");
  await app.keyboard.press("delete");
  expect(await saved(app)).toBe("\\[a](b)next\n");
});

test("`[ ] ` typed in a numbered list nested in a bullet list leaves the numbers alone", async () => {
  const app = await openDoc("- a\n  1. one\n  2. two\n");
  await app.waitFor("text:two");
  await app.press("text:two");
  await app.keyboard.press("end");
  await app.keyboard.press("enter");
  await typeEach(app, "[ ] x");
  const md = await saved(app);
  expect(md).toContain("1. one");
  expect(md).toContain("2. two");
});

test("closing a link keeps the bold and code inside its text", async () => {
  const app = await openDoc("[**b** and `c`](u\n");
  await app.waitFor("text:[b and c](u");
  await app.keyboard.press("end");
  await typeEach(app, ")");
  expect(await saved(app)).toBe("[**b** and `c`](u)\n");
});

test("link syntax typed inside inline code stays code", async () => {
  const app = await openDoc("");
  await typeEach(app, "`[a](b)` ok");
  expect(await saved(app)).toBe("`[a](b)` ok\n");
});

test("Markdown blocks pasted at the end of a paragraph keep their markers", async () => {
  const app = await openDoc("intro\n");
  await app.waitFor("text:intro");
  await app.keyboard.press("end");
  await app.paste(BODY, { text: "## Sub\n\n- one\n- two\n" });
  await app.waitFor("text:Sub");
  expect(await saved(app)).toBe("intro\n\n## Sub\n\n- one\n- two\n");
});

test("Markdown blocks pasted at the start of a paragraph go in above it", async () => {
  const app = await openDoc("hello world\n");
  await app.waitFor("text:hello world");
  await app.paste(BODY, { text: "# H\n\n- a\n" });
  await app.waitFor("text:H");
  expect(await saved(app)).toBe("# H\n\n- a\n\nhello world\n");
});

test("pasted lines with only inline marks keep their line breaks", async () => {
  const app = await openDoc("");
  await app.paste(BODY, { text: "line one\nuse **x** here\nline three" });
  await app.waitFor("text:line three");
  const md = await saved(app);
  expect(md.split("\n\n").length).toBe(3);
});

test("with the find bar open, the slash menu still shows when typing in the document", async () => {
  const app = await openDoc("hello\n");
  await app.press("text:hello");
  await app.keyboard.press("mod+f");
  await app.waitFor("id:find-bar");
  await app.press("text:hello");
  await app.keyboard.press("end");
  await app.keyboard.press("enter");
  await app.type(BODY, "/");
  await app.waitFor("id:slash-menu");
});

test("a backtick pair filled in afterwards becomes code once something follows it", async () => {
  const app = await openDoc("");
  await typeEach(app, "``");
  await app.keyboard.press("arrowleft");
  await typeEach(app, "abc");
  await app.keyboard.press("end");
  await typeEach(app, " x");
  expect(await saved(app)).toBe("`abc` x\n");
});

test("backticks that were already in the document as literal text are left alone", async () => {
  const src = "a \\`abc\\`\n";
  const app = await openDoc(src);
  await app.waitFor("text:a `abc`");
  await app.keyboard.press("end");
  await typeEach(app, ".");
  expect(await saved(app)).toBe("a \\`abc\\`.\n");
});
