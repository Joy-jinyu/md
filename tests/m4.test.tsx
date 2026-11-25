import { expect, open, test } from "nsh/test";
import { matchEmoji } from "../src/features/editor/emoji";
// 旧版（单篇）的正文键：存进去的那篇启动时原地成为文档库的第一篇，测试照旧在这里读写
import { LEGACY_DOC_KEY as DOC_KEY } from "../src/store/kv";
import { LAST_OPENED_KEY } from "../src/store/library";
import { seedLibrary } from "./fixtures/library";

const WEB = { platform: "web" as const, width: 1280, height: 860 };

const openDoc = (doc: string) => open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: doc } });
type App = Awaited<ReturnType<typeof openDoc>>;

async function saved(app: App): Promise<string> {
  await app.setLifecycle("background");
  return app.storage()[DOC_KEY] ?? "";
}

test("code in a block with a known language is colored, without a language it is not", async () => {
  const app = await openDoc("```js\nconst answer = 1;\n```\n\n```\nconst plain = 1;\n```\n");
  await app.wait(400);
  const keyword = app.spanStyle("id:editor >> text:const answer");
  const name = app.spanStyle("id:editor >> text:answer");
  const plain = app.spanStyle("id:editor >> text:const plain");
  expect(keyword.color).not.toBe(name.color);
  expect(plain.color).toBe(name.color);
});

test("the five alerts show their type as words", async () => {
  const kinds = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];
  const app = await openDoc(kinds.map((k) => `> [!${k}]\n> body ${k}\n`).join("\n"));
  await app.wait(300);
  const texts = app.texts();
  for (const label of ["备注", "提示", "重要", "警告", "小心"]) expect(texts).toContain(label);
});

test("the slash menu wraps the paragraph in an alert", async () => {
  const app = await openDoc("");
  await app.type("label:正文", "/tsk");
  await app.waitFor("id:slash-block.alert.note");
  await app.keyboard.press("enter");
  await app.type("label:正文", "记一下");
  expect(await saved(app)).toBe("> [!NOTE]\n> 记一下\n");
});

test("the table of contents lists the headings, follows edits and jumps; it is still saved as [toc]", async () => {
  const app = await openDoc("# Alpha\n\n[toc]\n\n## Beta\n\nbody\n");
  await app.waitFor("label:跳到「Beta」");
  await app.press("label:跳到「Beta」");
  await app.type("label:正文", "X");
  await app.waitFor("label:跳到「XBeta」");
  expect(await saved(app)).toBe("# Alpha\n\n[toc]\n\n## XBeta\n\nbody\n");
});

test("a footnote reference shows its text, jumps to the definition, and the definition jumps back", async () => {
  const app = await openDoc("See [^one] here.\n\n[^one]: The note text.\n");
  await app.waitFor("label:脚注 one：The note text.");
  await app.press("id:footnote-ref-one");
  await app.waitFor("id:atom-bar");
  await app.press("label:回到脚注 one 的引用处");
  await app.type("label:正文", "Z");
  expect(await saved(app)).toBe("See [^one]Z here.\n\n[^one]: The note text.\n");
});

test("front matter opens to show every line; the document opens with the caret in the text, not on it", async () => {
  const app = await openDoc("---\ntitle: T\nauthor: me\n---\n\n# Head\n");
  await app.waitFor("text:Head");
  expect(app.shows("id:atom-bar")).toBe(false);
  expect(app.texts().some((t) => t.includes("author: me"))).toBe(false);
  await app.press("label:展开 front matter");
  expect(app.texts().some((t) => t.includes("author: me"))).toBe(true);
  await app.type("label:正文", "X");
  expect(await saved(app)).toBe("---\ntitle: T\nauthor: me\n---\n\n# XHead\n");
});

test("an HTML block shows a preview, its source once selected, and keeps its bytes", async () => {
  const doc = '<div align="center">\n  <b>Centered</b>\n</div>\n\nafter\n';
  const app = await openDoc(doc);
  await app.waitFor("text:Centered");
  expect(app.texts()).toContain("HTML 预览");
  expect(app.texts().some((t) => t.includes("<b>"))).toBe(false);
  await app.press("text:Centered");
  await app.waitFor("text:HTML 源码");
  expect(app.texts().some((t) => t.includes("<b>Centered</b>"))).toBe(true);
  expect(await saved(app)).toBe(doc);
});

test("typing a colon and two letters offers emoji; picking one inserts the character", async () => {
  const app = await openDoc("start\n");
  await app.press("text:start");
  await app.keyboard.press("end");
  await app.type("label:正文", " :smi");
  await app.waitFor("id:emoji-menu");
  await app.keyboard.press("enter");
  await app.wait(200);
  expect(await saved(app)).toBe("start 😄\n");
});

test("colons in times, after letters and full-width colons do not offer emoji", async () => {
  const app = await openDoc("x\n");
  await app.press("text:x");
  await app.keyboard.press("end");
  // 全角冒号写成转义：格式化工具会把字面的全角冒号改成半角加空格
  for (const typed of [" 10:30", " key:smi", " \uFF1Asmi"]) {
    await app.type("label:正文", typed);
    await app.wait(100);
    expect(app.shows("id:emoji-menu")).toBe(false);
  }
  await app.keyboard.press("enter");
  await app.type("label:正文", "y");
  expect(await saved(app)).toBe("x 10:30 key:smi \uFF1Asmi\n\ny\n");
});

test("a code block in focus offers its language and a copy button that puts the code on the clipboard", async () => {
  // 光标打开时就落在第一个能打字的块里，这里就是代码块
  const app = await openDoc("```python\nprint(1)\n```\n");
  await app.waitFor("id:code-tools");
  expect(app.texts()).toContain("python");
  await app.press("label:复制代码");
  await app.waitFor("text:已复制");
  expect(app.clipboard()).toBe("print(1)");
  expect(await saved(app)).toBe("```python\nprint(1)\n```\n");
});

test("picking a language keeps the info after it; plain text with info is written as text so the info is not read as the language", async () => {
  const app = await openDoc("```js {1,3}\nconst a = 1;\n```\n");
  await app.waitFor("id:code-tools");
  await app.press("text:js");
  await app.waitFor("label:搜语言");
  await app.press("text:ts");
  await app.wait(200);
  expect(await saved(app)).toBe("```ts {1,3}\nconst a = 1;\n```\n");
  await app.setLifecycle("active");
  await app.press("text:const a = 1;");
  await app.waitFor("id:code-tools");
  await app.press("text:ts");
  await app.waitFor("label:搜语言");
  await app.press("text:纯文本");
  await app.wait(200);
  const out = await saved(app);
  expect(out).toBe("```text {1,3}\nconst a = 1;\n```\n");
  const again = await openDoc(out);
  await again.waitFor("id:code-tools");
  expect(again.texts()).toContain("text");
  await again.type("label:正文", "Z");
  expect(await saved(again)).toBe("```text {1,3}\nZconst a = 1;\n```\n");
});

test("the code block commands choose its language and copy it from the palette", async () => {
  const app = await openDoc("```js\nlet x = 1;\n```\n");
  await app.waitFor("id:code-tools");
  await app.keyboard.press("mod+shift+p");
  await app.waitFor("id:palette");
  await app.type("label:命令", "设置代码块语言");
  await app.keyboard.press("enter");
  await app.waitFor("label:搜语言");
  await app.press("text:python");
  await app.wait(200);
  expect(await saved(app)).toBe("```python\nlet x = 1;\n```\n");
  await app.setLifecycle("active");
  await app.press("text:let x = 1;");
  await app.keyboard.press("mod+shift+p");
  await app.waitFor("id:palette");
  await app.type("label:命令", "复制代码块");
  await app.keyboard.press("enter");
  await app.waitFor("text:已复制");
  expect(app.clipboard()).toBe("let x = 1;");
});

/** `n` 行、每行 4 段色（关键字、数字、字符串、注释）的 js 代码。 */
const jsCode = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `let ${tag}${i} = ${i}; "s"; // c`).join("\n");
const jsBlock = (tag: string, n: number) => "```js\n" + jsCode(tag, n) + "\n```\n";

test("colors are given to the blocks nearest the caret up to a total; a block too big on its own is not colored", async () => {
  // 最前面的块 300 行 × 4 段，自己就超过单块上限（1000）；后面每块 100 行 × 4 段 = 400 段，8 块 3200 段，超过全文上限（1000）。
  // 光标打开时在第一块里
  const doc = [jsBlock("huge", 300), ...Array.from({ length: 8 }, (_, b) => jsBlock(`b${b}x`, 100))].join("\n");
  const app = await openDoc(doc);
  await app.wait(400);
  const plain = app.spanStyle("id:editor >> text:b0x0").color;
  const colored = (text: string) => app.spanStyle(`id:editor >> text:${text}`).color !== plain;
  expect(colored("let b0x0")).toBe(true);
  expect(colored("let b1x0")).toBe(true);
  expect(colored("let b7x0")).toBe(false);
  expect(colored("let huge0")).toBe(false);
  // 光标走进没上色的块（文末那块）：它先上色，最远的让出来
  await app.press(`text:${jsCode("b7x", 100)}`);
  await app.wait(400);
  expect(colored("let b7x0")).toBe(true);
  expect(colored("let b0x0")).toBe(false);
});

test("typing in a code block colors the new words after a pause; typing elsewhere keeps the colors", async () => {
  const app = await openDoc("```js\nlet x\n```\n\npara\n");
  await app.wait(300);
  await app.press("text:let x");
  await app.keyboard.press("end");
  await app.type("label:正文", " return");
  await app.wait(400);
  const word = app.spanStyle("id:editor >> text:x").color;
  expect(app.spanStyle("id:editor >> text:return").color).not.toBe(word);
  await app.press("text:para");
  await app.keyboard.press("end");
  await app.type("label:正文", " more");
  await app.wait(400);
  expect(app.spanStyle("id:editor >> text:return").color).not.toBe(word);
});

test("no emoji menu in code, nor after a colon glued to a word; short queries match name starts only", async () => {
  const app = await openDoc("`code`\n\n```\nfoo\n```\n\nx\n");
  await app.press("text:code");
  await app.type("label:正文", " :smi");
  await app.wait(150);
  expect(app.shows("id:emoji-menu")).toBe(false);
  await app.press("text:foo");
  await app.keyboard.press("end");
  await app.type("label:正文", " :smi");
  await app.wait(150);
  expect(app.shows("id:emoji-menu")).toBe(false);
  await app.press("text:x");
  await app.keyboard.press("end");
  await app.type("label:正文", " 注意:ok");
  await app.wait(150);
  expect(app.shows("id:emoji-menu")).toBe(false);
  await app.keyboard.press("enter");
  // 行首的冒号算
  await app.type("label:正文", ":ok");
  await app.waitFor("id:emoji-menu");
  expect(app.shows("id:emoji-ok_hand")).toBe(true);
  expect(app.shows("id:emoji-broken_heart")).toBe(false);
  await app.type("label:正文", "_ha");
  await app.waitFor("id:emoji-ok_hand");
  await app.keyboard.press("escape");
  await app.type("label:正文", "z");
  const out = await saved(app);
  expect(out).toContain("x 注意:ok\n");
  expect(out).toContain("foo :smi\n");
});

test("an HTML block whose preview would show nothing shows its source", async () => {
  const doc = '<script>alert("x")</script>\n\n<img src="a.png">\n\n<p>seen</p>\n';
  const app = await openDoc(doc);
  await app.waitFor("text:seen");
  expect(app.texts().some((t) => t.includes('<script>alert("x")</script>'))).toBe(true);
  expect(app.texts().some((t) => t.includes('<img src="a.png">'))).toBe(true);
  expect(app.texts().filter((t) => t === "HTML 预览").length).toBe(1);
  expect(await saved(app)).toBe(doc);
});

test("links in an HTML preview are not opened, javascript: ones included", async () => {
  // nth=1 是链接本身（nth=0 是整段预览）
  for (const href of ["javascript:alert(1)", "https://example.com/x"]) {
    const app = await openDoc(`<p><a href="${href}">a link</a></p>\n\nafter\n`);
    await app.waitFor("text:a link");
    await app.press("text:a link >> nth=1");
    await app.wait(200);
    expect(app.openedUrls()).toEqual([]);
  }
});

test("the table of contents jumps to the heading it shows even after a heading was added above", async () => {
  const app = await openDoc("[toc]\n\n# One\n\n# Two\n\nend\n");
  await app.waitFor("label:跳到「Two」");
  await app.press("text:One >> nth=1");
  await app.keyboard.press("home");
  await app.keyboard.press("enter");
  await app.keyboard.press("up");
  await app.type("label:正文", "# Zero");
  // 目录还没刷新（停手 300ms 才刷）时点「Two」：跳到 Two，不是现在排第二的 One
  await app.press("label:跳到「Two」");
  await app.type("label:正文", "Q");
  expect(await saved(app)).toBe("[toc]\n\n# Zero\n\n# One\n\n# QTwo\n\nend\n");
});

test("front matter with a --- line is refused with a reason", async () => {
  const app = await openDoc("---\ntitle: T\n---\n\n# Head\n");
  await app.waitFor("text:Head");
  await app.press("text:Front matter · 1 行 · title: T");
  await app.press("label:编辑源码");
  await app.clear("label:Front matter（YAML）");
  await app.type("label:Front matter（YAML）", "a: 1\n---\nb: 2");
  await app.press("text:应用");
  await app.waitFor("id:atom-error");
  await app.press("text:取消");
  expect(await saved(app)).toBe("---\ntitle: T\n---\n\n# Head\n");
});

test("a formula with a $$ line is refused with a reason", async () => {
  const app = await openDoc("$$\nx\n$$\n\n# Head\n");
  await app.waitFor("label:公式：x");
  await app.press("label:公式：x");
  await app.press("label:编辑源码");
  await app.clear("label:公式块（LaTeX）");
  await app.type("label:公式块（LaTeX）", "x\n$$\n# INJECT");
  await app.press("text:应用");
  await app.waitFor("id:atom-error");
  // 改一下源码，原因就收起来
  await app.type("label:公式块（LaTeX）", "y");
  expect(app.shows("id:atom-error")).toBe(false);
  await app.press("text:取消");
  expect(app.shows("text:INJECT")).toBe(false);
  expect(await saved(app)).toBe("$$\nx\n$$\n\n# Head\n");
});

test("switching documents right after an edit does not show the old document's headings in the new one's table of contents", async () => {
  const docs = seedLibrary([
    { id: "da", name: "A", text: "# Alpha\n\nbody\n", updatedAt: 2 },
    { id: "db", name: "B", text: "[toc]\n\n# Beta\n", updatedAt: 1 },
  ]);
  const app = await open("../App.tsx", { ...WEB, storage: { ...docs, [LAST_OPENED_KEY]: "da" } });
  await app.waitFor("text:body");
  await app.press("id:toggle-sidebar");
  await app.waitFor("id:documents");
  await app.press("text:body");
  await app.type("label:正文", "X");
  await app.press("id:doc-db");
  await app.waitFor("label:跳到「Beta」");
  await app.wait(500);
  expect(app.shows("label:跳到「Alpha」")).toBe(false);
  expect(app.shows("label:跳到「Beta」")).toBe(true);
});

test("an inline formula whose source has a $ shows its source instead of reading the rest as Markdown", async () => {
  const app = await openDoc("a $x$ b\n");
  await app.waitFor("label:公式：x");
  await app.press("label:公式：x");
  await app.press("label:编辑源码");
  await app.clear("label:行内公式（LaTeX）");
  await app.type("label:行内公式（LaTeX）", "a$ [lnk](https://example.com) $b");
  await app.keyboard.press("enter");
  await app.wait(200);
  expect(app.texts().some((t) => t.includes("a$ [lnk](https://example.com) $b"))).toBe(true);
  expect(app.shows("text:lnk")).toBe(false);
});

test("emoji matching: two or three letters match name starts, four or more also names containing them", () => {
  expect(matchEmoji("ok").map((e) => e.name)).toEqual(["ok_hand", "ok"]);
  expect(matchEmoji("hea").every((e) => e.name.startsWith("hea"))).toBe(true);
  expect(matchEmoji("heart").some((e) => e.name === "green_heart")).toBe(true);
});
