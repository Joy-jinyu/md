import { chain, insertText, setTextSelection } from "nsh/base";
import { expect, test } from "nsh/test";
import type { MdBlock } from "../src/doc/types";
import { dumpMarkdown } from "../src/features/editor/convert";
import { parseMarkdown } from "../src/features/editor/parse";
import { FULL_SYNTAX } from "./fixtures/full-syntax";
import { firstBlockDiff, firstTextDiff, forceRewrite, nodeSize, normalize, openDoc, reread, tick, type Node, type Opened } from "./fixtures/kit";
import { longDoc, looseList, SAMPLES, sectionDoc } from "./fixtures/samples";

const SMALL: Record<string, string> = { "full-syntax": FULL_SYNTAX, ...SAMPLES };
const BIG: Record<string, string> = { "loose-list-800": looseList(800), "long-doc": longDoc(600), "sections-2500": sectionDoc(2500) };
const ALL: Record<string, string> = { ...SMALL, ...BIG };
// 含定义行（包括引用块里嵌套的）的块：删改它会按约定强制重写引用它的块，不在「其余块不变」的范围
const DEF_SRC = /^(?:[ \t]*>)*[ \t]*\[\^?[^\]]+\]:/m;
const FOOTNOTE_DEF = /^ {0,3}\[\^[^\]]+\]:/;
const CHANGED = "Z 改动";
const P = (text: string): Node => ({ type: "paragraph", content: [{ type: "text", text }] });

/** 均匀挑至多 limit 个下标 */
function spread(n: number, limit: number): number[] {
  if (n <= limit) return Array.from({ length: n }, (_, i) => i);
  return [...new Set(Array.from({ length: limit }, (_, k) => Math.floor((k * (n - 1)) / (limit - 1))))];
}

function finish(o: Opened, body: string): string {
  return (o.origin.bom ? "﻿" : "") + (o.origin.crlf ? body.replace(/\n/g, "\r\n") : body);
}

/** 把第 s 片换成一段新段落后，期望写出的全文：其余切片和它们之间的空行原样 */
function expectedWithReplaced(o: Opened, s: number): string {
  const sl = o.origin.slices;
  const body = sl.map((x, i) => (i === s ? CHANGED : x.text) + (i === sl.length - 1 ? x.sep : i === s || i + 1 === s ? "\n\n" : x.sep)).join("");
  return finish(o, o.origin.lead + body);
}

/** 按文档顺序列出每个列表的松紧：直接用解析器读写出的 Markdown，不经过 toDoc，免得两边一起丢 */
function looseness(md: string): boolean[] {
  const walk = (b: MdBlock): boolean[] =>
    b.type === "list" ? [b.loose === true, ...b.items.flatMap((it) => it.children.flatMap(walk))] : b.type === "blockquote" ? b.children.flatMap(walk) : [];
  return parseMarkdown(md).slices.flatMap((s) => s.blocks.flatMap(walk));
}

for (const [name, src] of Object.entries(ALL)) {
  test(`${name}：① 不改直接保存，逐字节相同`, () => {
    const o = openDoc(src);
    expect(firstTextDiff(src, dumpMarkdown(o.json, o.origin))).toBe(null);
  });

  test(`${name}：② 改一块，其余块逐字节相同`, async () => {
    const o = openDoc(src);
    const nodes = o.json.content ?? [];
    const candidates = o.origin.slices.flatMap((s, i) => (s.count === 1 && !DEF_SRC.test(s.text) ? [i] : []));
    const failures: string[] = [];
    for (const s of spread(candidates.length, 12).map((k) => candidates[k])) {
      const j = o.origin.slices[s].first;
      const content = [...nodes.slice(0, j), P(CHANGED), ...nodes.slice(j + 1)];
      const diff = firstTextDiff(expectedWithReplaced(o, s), dumpMarkdown({ ...o.json, content }, o.origin));
      if (diff) failures.push(`slice ${s}: ${diff}`);
      await tick();
    }
    expect(failures).toEqual([]);
  });

  test(`${name}：③ 全部重写后再读再写不变；④ 重写前后读出的 JSON 相同`, async () => {
    const o = openDoc(src);
    const once = forceRewrite(o);
    await tick();
    const again = openDoc(once);
    expect(firstBlockDiff(normalize(o.json), normalize(again.json))).toBe(null);
    expect(looseness(once)).toEqual(looseness(src));
    await tick();
    expect(firstTextDiff(once, forceRewrite(again))).toBe(null);
  });
}

type Edit = { name: string; content: Node[] };

function move(nodes: Node[], from: number, to: number): Node[] {
  const rest = [...nodes.slice(0, from), ...nodes.slice(from + 1)];
  return [...rest.slice(0, to), nodes[from], ...rest.slice(to)];
}

function splitParagraph(node: Node): Node[] | null {
  const head = node.content?.[0];
  const chars = Array.from(head?.text ?? "");
  if (node.type !== "paragraph" || head?.type !== "text" || chars.length < 2) return null;
  const h = Math.floor(chars.length / 2);
  return [
    { ...node, content: [{ ...head, text: chars.slice(0, h).join("") }] },
    { ...node, content: [{ ...head, text: chars.slice(h).join("") }, ...(node.content ?? []).slice(1)] },
  ];
}

function editsAt(nodes: Node[], i: number): Edit[] {
  const n = nodes.length;
  const out: Edit[] = [
    { name: `delete ${i}`, content: [...nodes.slice(0, i), ...nodes.slice(i + 1)] },
    { name: `move ${i}->end`, content: move(nodes, i, n - 1) },
    { name: `duplicate ${i}`, content: [...nodes.slice(0, i + 1), nodes[i], ...nodes.slice(i + 1)] },
    { name: `insert after ${i}`, content: [...nodes.slice(0, i + 1), P("插入的段落"), ...nodes.slice(i + 1)] },
  ];
  if (i + 2 < n) out.push({ name: `move ${i}->${i + 2}`, content: move(nodes, i, i + 2) });
  const split = splitParagraph(nodes[i]);
  if (split) out.push({ name: `split ${i}`, content: [...nodes.slice(0, i), ...split, ...nodes.slice(i + 1)] });
  const next = nodes[i + 1];
  if (nodes[i].type === "paragraph" && next?.type === "paragraph") {
    const joined = { ...nodes[i], content: [...(nodes[i].content ?? []), ...(next.content ?? [])] };
    out.push({ name: `join ${i}+${i + 1}`, content: [...nodes.slice(0, i), joined, ...nodes.slice(i + 2)] });
  }
  return out;
}

const srcOf = (node: Node | undefined): string => String(node?.attrs?.src ?? "");

/** front matter 只能在第一个位置，被挪走后按约定写成代码块，读回来不再是 front matter；脚注定义删掉后引用读回来是文字。这两类编辑不在比较范围 */
function comparable(before: Node[], e: Edit): boolean {
  const fm = e.content.findIndex((x) => x.type === "frontmatter");
  if (fm > 0 || e.content.filter((x) => x.type === "frontmatter").length > 1) return false;
  const removed = before.filter((x) => !e.content.includes(x));
  return !removed.some((x) => x.type === "rawBlock" && FOOTNOTE_DEF.test(srcOf(x)));
}

function structuralEdits(nodes: Node[], limit: number): Edit[] {
  const defDeletes = nodes.flatMap((x, i) =>
    x.type === "rawBlock" && DEF_SRC.test(srcOf(x)) && !FOOTNOTE_DEF.test(srcOf(x)) ? [{ name: `delete definition ${i}`, content: [...nodes.slice(0, i), ...nodes.slice(i + 1)] }] : [],
  );
  return [...spread(nodes.length, limit).flatMap((i) => editsAt(nodes, i)), ...defDeletes].filter((e) => comparable(nodes, e));
}

const LIMITS: Record<string, number> = { "long-doc": 3, "sections-2500": 0 };

for (const [name, src] of Object.entries(ALL)) {
  const limit = LIMITS[name] ?? 40;
  if (limit === 0) continue;
  test(
    `${name}：⑤ 删 / 移 / 复制 / 插入 / 拆段 / 并段 / 删定义行之后，写出再读等于编辑器内容`,
    async () => {
      const o = openDoc(src);
      const failures: string[] = [];
      const edits = structuralEdits(o.json.content ?? [], limit);
      console.log(`EDITS ${name}: ${edits.length}`);
      for (const e of edits) {
        const edited = { ...o.json, content: e.content };
        const md = dumpMarkdown(edited, o.origin);
        const diff = firstBlockDiff(normalize(edited), reread(md));
        if (diff) failures.push(`${e.name}: ${diff}`);
        await tick();
      }
      expect(failures).toEqual([]);
    },
    180_000,
  );
}

/** S0 第 13 项：会话里给一个段落插一个字，比较每个顶层块的 JSON 字符串 */
for (const name of ["full-syntax", "long-doc"]) {
  test(`${name}：S0-13 插入一个字，只有那一块的 JSON 和原文变了`, async () => {
    const src = ALL[name];
    const o = openDoc(src);
    const nodes = o.json.content ?? [];
    const before = nodes.map((n) => JSON.stringify(n));
    const candidates = nodes.flatMap((n, i) => (n.type === "paragraph" && n.content?.[0]?.type === "text" && o.origin.slices[o.origin.owner[i]].count === 1 ? [i] : []));
    const k = candidates[Math.floor(candidates.length / 2)];
    const pos = nodes.slice(0, k).reduce((p, n) => p + nodeSize(n), 0);
    expect(o.session.nodeAt(pos)?.type).toBe("paragraph");
    o.session.run(chain([setTextSelection(pos + 1), insertText("Q")]));
    await tick();
    const live = o.session.getJSON();
    const after = (live.content ?? []).map((n) => JSON.stringify(n));
    const changed = before.flatMap((b, i) => (b !== after[i] ? [i] : []));
    console.log(`S0-13 ${name}: blocks=${before.length} edited=${k} changed=${JSON.stringify(changed)} appended=${JSON.stringify(after.slice(before.length))}`);
    expect(changed).toEqual([k]);
    const s = o.origin.owner[k];
    const sl = o.origin.slices;
    const prefix = o.origin.lead + sl.slice(0, s).map((x, i) => x.text + (i === s - 1 ? "\n\n" : x.sep)).join("");
    const suffix = sl.slice(s + 1).map((x) => x.text + x.sep).join("");
    const out = dumpMarkdown(live, o.origin);
    expect(out.startsWith(finish(o, prefix))).toBe(true);
    expect(out.endsWith(finish(o, suffix))).toBe(true);
    expect(out.slice(prefix.length, out.length - suffix.length)).toContain("Q");
  });
}

/** 没有文字可挂 mark 的写法：改了别的块、或者整篇重写，原文里的这一段都必须还在。直接和源文本比，不经过 toDoc */
const KEPT: Record<string, { src: string; rewritten: string }> = {
  "空文字链接独占一段": { src: "before\n\n[](http://empty.text)\n\nafter\n", rewritten: "before\n\n[](http://empty.text)\n\nafter\n" },
  "空文字的引用式链接": { src: "[][A]\n\n[A]: http://x\n", rewritten: "[](http://x)\n\n[A]: http://x\n" },
  "空的成对标签独占一段": { src: "x\n\n<b></b>\n\ny\n", rewritten: "x\n\n<b></b>\n\ny\n" },
  "行内的空文字链接带标题": { src: 'a [](http://u "t") b\n', rewritten: 'a [](http://u "t") b\n' },
  "只有空白的成对标签": { src: "a <u> </u> b\n", rewritten: "a <u> </u> b\n" },
  "列表项里的空文字链接": { src: "- [](http://u)\n- two\n", rewritten: "- [](http://u)\n- two\n" },
  "表格里空文字链接的地址带竖线": { src: "| a | b |\n|---|---|\n| [](http://u/a\\|b) | x |\n", rewritten: "| a | b |\n| --- | --- |\n| [](http://u/a\\|b) | x |\n" },
  "表格里链接的地址和标题带竖线": { src: '| a | b |\n|---|---|\n| [t](http://u/a\\|b "p\\|q") | `c\\|d` |\n', rewritten: '| a | b |\n| --- | --- |\n| [t](http://u/a\\|b "p\\|q") | `c\\|d` |\n' },
  "转义的感叹号后面跟空文字链接": { src: "a \\![](http://u) b\n", rewritten: "a \\![](http://u) b\n" },
  "链接文字只有一个空格的行内代码": { src: "[` `](http://u)\n", rewritten: "[` `](http://u)\n" },
  "正文里的两个等号不是高亮": { src: "if a == b or c == d\n", rewritten: "if a == b or c == d\n" },
  "Typora 的下标、上标、高亮和删除线": { src: "H~2~O x^2^ ==h== ~~d~~\n", rewritten: "H~2~O x^2^ ==h== ~~d~~\n" },
  "转义的波浪线和尖角号不是上下标": { src: "\\~x\\~ \\^y\\^\n", rewritten: "\\~x\\~ \\^y\\^\n" },
  "HTML 写的上下标重写成 Typora 写法": { src: "<sub>2</sub> <sup>3</sup>\n", rewritten: "~2~ ^3^\n" },
  "表格的列对齐写回分隔行": { src: "| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n", rewritten: "| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |\n" },
};

/** 一段里各处文字挂着哪些 mark */
function marksIn(src: string): [string, string[]][] {
  const para = openDoc(src).json.content?.[0];
  return (para?.content ?? []).map((n) => [n.text ?? n.type, (n.marks ?? []).map((m) => m.type)]);
}

test("~x~ 读成下标、^x^ 读成上标，~~x~~ 和带空格的 ~x y~ 是删除线，转义的和代码里的不变", () => {
  expect(marksIn("H~2~O x^2^ ~~d~~ ~a b~\n")).toEqual([
    ["H", []],
    ["2", ["subscript"]],
    ["O x", []],
    ["2", ["superscript"]],
    [" ", []],
    ["d", ["strike"]],
    [" ", []],
    ["a b", ["strike"]],
  ]);
  expect(marksIn("\\~x\\~ `^y^`\n")).toEqual([
    ["~x~ ", []],
    ["^y^", ["code"]],
  ]);
});

for (const [name, { src, rewritten }] of Object.entries(KEPT)) {
  test(`${name}：文末加一段后原文都在；整篇重写后不丢`, () => {
    const o = openDoc(src);
    const appended = dumpMarkdown({ ...o.json, content: [...(o.json.content ?? []), P(CHANGED)] }, o.origin);
    expect(appended).toBe(`${src}\n${CHANGED}\n`);
    const once = forceRewrite(o);
    expect(once).toBe(rewritten);
    expect(forceRewrite(openDoc(once))).toBe(once);
  });
}

/**
 * 段尾空白：Markdown 表达不了段尾的空白和只有空白的段落，写成 `&#32;` 会让用户在文件里看到怪字（只按了一下空格就存成 `&#32;`）。
 * 约定：只有空白的段落不写，段落最后一行行尾的空白去掉；段首的空白仍写成实体，读回来还在。
 */
test("段尾空白：只有空白的段落不写，段尾空白去掉，段首空白仍用实体保住", () => {
  const o = openDoc("");
  const dump = (...paragraphs: string[]) => dumpMarkdown({ ...o.json, content: paragraphs.map(P) }, o.origin);
  expect(dump(" ")).toBe("");
  expect(dump("a", " \t ", "b")).toBe("a\n\nb\n");
  expect(dump("hello  ")).toBe("hello\n");
  expect(dump(" hello")).toBe("&#32;hello\n");
  expect(firstBlockDiff(normalize({ ...o.json, content: [P(" hello")] }), reread(dump(" hello")))).toBe(null);
  const list = { type: "bulletList", content: [{ type: "listItem", content: [P(" "), P("b")] }] } as Node;
  expect(dumpMarkdown({ ...o.json, content: [list] }, o.origin)).toBe("- b\n");
});
