import { command, type RichEditorSession, setTextSelection } from "nsh/base";
import { expect, open, test } from "nsh/test";
import { cellSelectionText, selectionMarkdown } from "../src/doc/selection-markdown";
import type { PMNode } from "../src/doc/types";
import { type Segmenter, selectLine, selectWord, wordAround } from "../src/features/editor/select";
import { LEGACY_DOC_KEY as DOC_KEY } from "../src/store/kv";
import { openDoc } from "./fixtures/kit";
import { LIBRARY, memoryFs } from "./fixtures/memory-fs";

const SIZE = { width: 1280, height: 860 };

/** macOS 应用：文档是文库里的 Doc.md。 */
async function openMac(doc: string) {
  const disk = memoryFs({ "Doc.md": doc });
  const app = await open("../App.tsx", { platform: "macos", ...SIZE, modules: disk.modules });
  await app.waitFor("id:editor");
  await app.wait(200);
  return { app, disk };
}

const openWeb = async (doc: string) => {
  const app = await open("../App.tsx", { platform: "web", ...SIZE, storage: { [DOC_KEY]: doc } });
  await app.waitFor("id:editor");
  await app.wait(200);
  return app;
};

type App = Awaited<ReturnType<typeof openWeb>>;

async function copied(app: App, keys = "mod+shift+c"): Promise<string | null> {
  await app.keyboard.press(keys);
  await app.wait(100);
  return app.clipboard();
}

async function runFromPalette(app: App, name: string) {
  await app.keyboard.press("mod+shift+p");
  await app.waitFor("id:palette");
  await app.type("label:命令", name);
  await app.keyboard.press("enter");
  await app.wait(200);
}

test("Cmd+D selects the word at the caret, then the next same text; Cmd+Shift+C copies the selection as Markdown", async () => {
  const { app } = await openMac("# T\n\nbeta one **beta** two\n\nlast beta\n");
  await app.press("text:beta one beta two");
  await app.keyboard.press("home");
  expect(await copied(app, "mod+d")).toBe(null);
  expect(await copied(app)).toBe("beta");
  await app.keyboard.press("mod+d");
  expect(await copied(app)).toBe("**beta**");
  await app.keyboard.press("mod+d");
  expect(await copied(app)).toBe("beta");
  await app.keyboard.press("mod+d");
  await app.keyboard.press("mod+l");
  expect(await copied(app)).toBe("beta one **beta** two");
});

test("Cmd+L selects the line and then the next one; Cmd+E grows from the formatted run to the whole block", async () => {
  const { app } = await openMac("# Title\n\nfirst **bold [link](https://x.y) text** end\n\n- item\n");
  await app.press("text:link");
  await app.keyboard.press("mod+e");
  expect(await copied(app)).toBe("[**link**](https://x.y)");
  await app.keyboard.press("mod+e");
  expect(await copied(app)).toBe("**bold [link](https://x.y) text**");
  await app.keyboard.press("mod+e");
  expect(await copied(app)).toBe("first **bold [link](https://x.y) text** end");
  await app.press("text:Title");
  await app.keyboard.press("mod+l");
  expect(await copied(app)).toBe("Title");
  await app.keyboard.press("mod+l");
  expect(await copied(app)).toBe("# Title\n\nfirst **bold [link](https://x.y) text** end");
});

test("copying a selection across blocks writes the blocks; with nothing selected the whole document is copied", async () => {
  const doc = "# T\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
  const { app } = await openMac(doc);
  await app.press("text:two");
  expect(await copied(app)).toBe(doc);
  expect(app.shows("text:没有选中内容，已把整篇的 Markdown 复制到剪贴板。")).toBe(true);
  await app.press("text:one");
  await app.keyboard.press("shift+arrowdown");
  await app.keyboard.press("shift+arrowdown");
  expect(await copied(app)).toBe("- one\n- two\n\n| a | b |\n| --- | --- |");
});

test("in the browser the select commands default to Ctrl+Alt keys, which the browser leaves alone", async () => {
  const app = await openWeb("one two\n");
  await app.press("text:one two");
  await app.keyboard.press("ctrl+alt+l");
  expect(await copied(app, "ctrl+alt+m")).toBe("one two");
  await app.keyboard.press("mod+,");
  await app.waitFor("text:选中当前行");
  expect(app.texts()).toContain("复制为 Markdown");
});

/**
 * 打字机模式这里只测开关和标签。光标是否停在正文中间、鼠标拖选时内容不滑走、滚轮滚走后不被拽回、改窗口大小和从源码视图切回后重新居中，
 * 无头测试里量不到滚动位置、也发不出带按键状态的鼠标移动，只靠浏览器实测（实施计划 9 节的记录）。
 */
test("the typewriter mode turns on with F9 or the palette and shows a chip that turns it off", async () => {
  const app = await openWeb("# T\n\ntext\n");
  await app.keyboard.press("f9");
  await app.waitFor("label:退出打字机模式");
  await app.press("label:退出打字机模式");
  await app.wait(100);
  expect(app.shows("label:退出打字机模式")).toBe(false);
  await runFromPalette(app, "打字机");
  expect(app.shows("label:退出打字机模式")).toBe(true);
});

test("a rule inserted at the end of the document leaves the caret in a new paragraph after it", async () => {
  const app = await openWeb("# T\n\nlast\n");
  await app.press("text:last");
  await app.keyboard.press("end");
  await app.keyboard.press("enter");
  await runFromPalette(app, "分隔线");
  await app.type("label:正文", "after");
  await app.setLifecycle("background");
  expect(app.storage()[DOC_KEY]).toBe("# T\n\nlast\n\n---\n\nafter\n");
});

test("export as HTML on the desktop writes a self-contained page to Downloads under the title", async () => {
  const { app, disk } = await openMac("# Trip <plan>\n\n[go](javascript:alert(1)) and **bold**\n");
  await runFromPalette(app, "导出为 HTML");
  await app.waitFor("id:receipt");
  const html = disk.files.get("/Users/t/Downloads/Trip plan.html");
  expect(typeof html).toBe("string");
  expect(html).toContain("<title>Trip &lt;plan&gt;</title>");
  expect(html).toContain("<a>go</a> and <strong>bold</strong>");
  expect(disk.files.get(`${LIBRARY}/Doc.md`)).toBe("# Trip <plan>\n\n[go](javascript:alert(1)) and **bold**\n");
  expect(app.shows("text:已存到 /Users/t/Downloads/Trip plan.html。用浏览器打开它，可以再打印或存成 PDF。")).toBe(true);
});

test("a document too long to convert in one go is not exported; the receipt says so and points to Save As", async () => {
  const lines = Array.from({ length: 20_001 }, (_, i) => `- [^n${i}] 第 ${i} 行`);
  const app = await open("../App.tsx", { platform: "web", ...SIZE, storage: { [DOC_KEY]: `# Long\n\n${lines.join("\n")}\n` } });
  await app.waitFor("text:# Long");
  await runFromPalette(app, "导出为 HTML");
  await app.waitFor("text:这篇太长，导出不了 HTML；可以另存为 .md。");
});

/** 文档里第 `nth` 次出现 `needle` 的起点（文档位置）。 */
function posOf(session: RichEditorSession, needle: string, nth = 0): number {
  const size = (session.getJSON() as PMNode).content?.length ? 10_000 : 0;
  let seen = 0;
  for (let p = 0; p < size; p++) {
    let text = "";
    try {
      text = session.textBetween(p, p + needle.length, "\n");
    } catch {
      break;
    }
    if (text === needle && seen++ === nth) return p;
  }
  throw new Error(`not found: ${needle}`);
}

/** 从 `a` 的起点选到 `b` 的终点，复制为 Markdown 得到的文字。 */
function copiedBetween(md: string, a: string, b: string = a, nb = 0): string {
  const { session } = openDoc(md);
  return selectionMarkdown(session.getJSON() as PMNode, posOf(session, a), posOf(session, b, nb) + b.length);
}

test("a selection inside a paragraph keeps its edge spaces as spaces", () => {
  expect(copiedBetween("hello world again\n", " world ")).toBe(" world ");
  expect(copiedBetween("a **bold** b\n", " bold")).toBe(" **bold**");
});

test("a selection that stops at the start of the next block copies no empty shell of that block", () => {
  const { session } = openDoc("para\n\n# Head\n\n- item\n\nlast\n");
  const doc = session.getJSON() as PMNode;
  expect(selectionMarkdown(doc, 1, posOf(session, "Head"))).toBe("para");
  expect(selectionMarkdown(doc, 1, posOf(session, "item"))).toBe("para\n\n# Head");
});

test("copying list items keeps their numbers and only the level that was selected", () => {
  expect(copiedBetween("1. a\n2. b\n3. c\n4. d\n", "c", "d")).toBe("3. c\n4. d");
  expect(copiedBetween("- a\n  - b\n  - c\n- d\n", "b", "c")).toBe("- b\n- c");
  expect(copiedBetween("- a\n  - b\n  - c\n- d\n", "c", "d")).toBe("- c\n\n* d");
});

test("inside a table the selected cells copy as text: tabs between cells, a line per row", () => {
  const md = "| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n";
  expect(copiedBetween(md, "b", "1")).toBe("b\n1");
  const { session } = openDoc(md);
  const doc = session.getJSON() as PMNode;
  // 单元格选区的两头是格子前面的位置：格子里的字往前两格（段落开头、格子开头）
  expect(cellSelectionText(doc, posOf(session, "b") - 2, posOf(session, "3") - 2)).toBe("a\tb\n1\t2\n3\t4");
  expect(cellSelectionText(doc, posOf(session, "2") - 2, posOf(session, "4") - 2)).toBe("2\n4");
  expect(copiedBetween("para\n\n" + md, "ra", "1")).toBe("ra\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
});

test("copy as Markdown with a formula block selected copies that block, not the whole document", async () => {
  const app = await openWeb("# T\n\nbefore\n\n$$\nE=mc^2\n$$\n\nafter\n");
  await app.press("text:E=mc^2");
  await app.wait(100);
  expect(await copied(app, "ctrl+alt+m")).toBe("$$\nE=mc^2\n$$");
});

test("when the clipboard cannot be written, copy as Markdown says so", async () => {
  const app = await open("../App.tsx", {
    platform: "web",
    ...SIZE,
    storage: { [DOC_KEY]: "# T\n\nbody\n" },
    modules: {
      nsh: {
        "Clipboard.writeText": () => {
          throw new Error("denied");
        },
      },
    },
  });
  await app.waitFor("id:editor");
  await app.press("text:body");
  await app.keyboard.press("ctrl+alt+m");
  await app.waitFor("text:没能复制：写不了剪贴板。可以切到源码视图，选中后按复制键。");
});

test("without Intl.Segmenter a word is whole code points: emoji, CJK beyond the BMP, and apostrophes inside words", () => {
  const text = "a😀b 𠮷野家 don't x";
  const word = (at: number) => {
    const w = wordAround(text, at, null);
    return w ? text.slice(w[0], w[1]) : null;
  };
  expect(word(1)).toBe("😀");
  expect(word(2)).toBe("😀");
  expect(word(5)).toBe("𠮷野家");
  expect(word(6)).toBe("𠮷野家");
  expect(word(10)).toBe("don't");
  expect(word(14)).toBe("don't");
});

test("with a segmenter the word comes from its word-like segments", () => {
  const fake: Segmenter = {
    segment: (t: string) => [
      { segment: t.slice(0, 2), index: 0, isWordLike: true },
      { segment: t.slice(2, 4), index: 2, isWordLike: true },
      { segment: t.slice(4), index: 4, isWordLike: false },
    ],
  };
  expect(wordAround("今天天气，", 1, fake)).toEqual([0, 2]);
  expect(wordAround("今天天气，", 2, fake)).toEqual([2, 4]);
  expect(wordAround("今天天气，", 4, fake)).toEqual([2, 4]);
  expect(wordAround("今天天气，x", 5, fake)).toBe(null);
});

/** 选区里的字。 */
function selected(session: RichEditorSession): string {
  const { anchor = 0, head = anchor } = session.selection;
  return session.textBetween(Math.min(anchor, head), Math.max(anchor, head), "\n");
}

test("select word then next occurrence matches whole words only, case-sensitively", () => {
  const { session } = openDoc("foo Foo food foo\n");
  session.run(setTextSelection(posOf(session, "foo") + 1));
  selectWord(session);
  expect(selected(session)).toBe("foo");
  selectWord(session);
  expect(session.selection.anchor).toBe(posOf(session, "foo", 2));
  selectWord(session);
  expect(session.selection.anchor).toBe(posOf(session, "foo", 0));
});

test("select line in a table cell goes on to the whole row and then the next row; on an empty line it stays put", () => {
  const { session } = openDoc("| a | b |\n| - | - |\n| 1 | 2 |\n");
  session.run(setTextSelection(posOf(session, "a")));
  selectLine(session);
  expect(selected(session)).toBe("a");
  selectLine(session);
  expect(session.selection.type).toBe("cell");
  expect(cellSelectionText(session.getJSON() as PMNode, session.selection.anchor ?? 0, session.selection.head ?? 0)).toBe("a\tb");
  selectLine(session);
  expect(cellSelectionText(session.getJSON() as PMNode, session.selection.anchor ?? 0, session.selection.head ?? 0)).toBe("a\tb\n1\t2");
  const empty = openDoc("one\n\ntwo\n");
  empty.session.run(setTextSelection(posOf(empty.session, "one") + 3));
  empty.session.run(command("splitBlock"));
  selectLine(empty.session);
  expect(selected(empty.session)).toBe("");
});
