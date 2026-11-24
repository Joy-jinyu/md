import { linkDest, linkTitle } from "./to-markdown";
import type { MdBlock, MdInline, MdListItem, PMMark, PMNode } from "./types";

/** 成对出现时转成 mark 的 HTML 标签；其余标签原样留在 htmlInline 里 */
const TAG_MARK: Record<string, string> = {
  u: "underline",
  mark: "highlight",
  sub: "subscript",
  sup: "superscript",
  s: "strike",
  del: "strike",
  strike: "strike",
  b: "bold",
  strong: "bold",
  i: "italic",
  em: "italic",
};

const STYLE_MARK: Record<string, string> = {
  strong: "bold",
  emphasis: "italic",
  strikethrough: "strike",
  underline: "underline",
  superscript: "superscript",
  subscript: "subscript",
  highlight: "highlight",
};

/** 互相排斥、不能同时挂在一段文字上的 mark */
const CONFLICT: Record<string, string> = { subscript: "superscript", superscript: "subscript" };

type Tagged = { type: "tagged"; mark: string; open: string; close: string; content: Item[] };
type Item = MdInline | Tagged;

const BR = /^<br\s*\/?>$/i;
const OPEN_TAG = /^<([a-z]+)>$/i;

function htmlOf(item: Item): string | null {
  return item.type === "custom" && item.name === "html" ? (item.text ?? "") : null;
}

function findClose(items: Item[], from: number, tag: string): number {
  let depth = 0;
  for (let k = from; k < items.length; k++) {
    const html = htmlOf(items[k])?.toLowerCase();
    if (html === `<${tag}>`) depth++;
    else if (html === `</${tag}>`) {
      if (depth === 0) return k;
      depth--;
    }
  }
  return -1;
}

/** 把同一层里成对的 <u>…</u> 之类配成 mark，<br> 变换行；配不上的标签保持原样 */
function pairTags(items: MdInline[]): Item[] {
  const out: Item[] = [];
  let i = 0;
  while (i < items.length) {
    const html = htmlOf(items[i]);
    if (html !== null && BR.test(html)) {
      out.push({ type: "break" });
      i++;
      continue;
    }
    const tag = html === null ? null : (OPEN_TAG.exec(html)?.[1].toLowerCase() ?? null);
    const close = tag && TAG_MARK[tag] ? findClose(items, i + 1, tag) : -1;
    if (tag && close > 0) {
      const inner = pairTags(items.slice(i + 1, close));
      out.push({ type: "tagged", mark: TAG_MARK[tag], open: html!, close: htmlOf(items[close])!, content: inner });
      i = close + 1;
      continue;
    }
    out.push(items[i]);
    i++;
  }
  return out;
}

function withMark(marks: PMMark[], mark: PMMark): PMMark[] {
  return [...marks.filter((m) => m.type !== mark.type), mark];
}

function textNode(text: string, marks: PMMark[]): PMNode[] {
  if (text === "") return [];
  return [marks.length ? { type: "text", text, marks } : { type: "text", text }];
}

function atom(type: string, attrs: Record<string, unknown>, marks: PMMark[]): PMNode {
  return marks.length ? { type, attrs, marks } : { type, attrs };
}

/** 写出时 mark 只包非空白的内容（行内代码不管里面是什么都算）：一组节点里没有这样的内容，mark 就会丢 */
function hasVisible(nodes: PMNode[]): boolean {
  return nodes.some((n) => n.type !== "text" || (n.text ?? "").trim() !== "" || (n.marks ?? []).some((m) => m.type === "code"));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function convertTagged(item: Tagged, marks: PMMark[]): PMNode[] {
  const conflict = CONFLICT[item.mark];
  if (conflict && marks.some((m) => m.type === conflict)) {
    return [atom("htmlInline", { html: item.open }, marks), ...convertItems(item.content, marks), atom("htmlInline", { html: item.close }, marks)];
  }
  if (!hasVisible(convertItems(item.content, []))) {
    return [atom("htmlInline", { html: item.open }, marks), ...convertItems(item.content, marks), atom("htmlInline", { html: item.close }, marks)];
  }
  return convertItems(item.content, withMark(marks, { type: item.mark }));
}

/** 链接文字为空或只有空白时没有文字能挂 mark，整个链接按固定写法留成一个 htmlInline（引用式会变成行内式） */
function convertLink(item: Extract<MdInline, { type: "link" }>, marks: PMMark[]): PMNode[] {
  const plain = convertItems(pairTags(item.content), []);
  if (!hasVisible(plain)) {
    const text = plain.map((n) => n.text ?? "").join("");
    return [atom("htmlInline", { html: `[${text}](${linkDest(item.url)}${linkTitle(item.title)})` }, marks)];
  }
  return convertItems(pairTags(item.content), withMark(marks, { type: "link", attrs: { href: item.url, title: item.title ?? null } }));
}

function convertCustom(item: Extract<MdInline, { type: "custom" }>, marks: PMMark[]): PMNode[] {
  if (item.name === "html") return [atom("htmlInline", { html: item.text ?? "" }, marks)];
  if (item.name === "hl") return textNode(item.attributes?.["1"] ?? "", withMark(marks, { type: "highlight" }));
  return textNode(item.text ?? "", marks);
}

function convertItem(item: Item, marks: PMMark[]): PMNode[] {
  switch (item.type) {
    case "text":
      return textNode(item.text, marks);
    case "tagged":
      return convertTagged(item, marks);
    case "code":
      return textNode(item.code, withMark(marks, { type: "code" }));
    case "keyboard":
      return [atom("htmlInline", { html: `<kbd>${escapeHtml(item.text)}</kbd>` }, marks)];
    case "small":
      return [atom("htmlInline", { html: "<small>" }, marks), ...convertItems(pairTags(item.content), marks), atom("htmlInline", { html: "</small>" }, marks)];
    case "link":
      return convertLink(item, marks);
    case "image":
      return [atom("image", { src: item.src, alt: item.alt ?? "", title: item.title ?? null }, marks)];
    case "math":
      return [atom("mathInline", { tex: item.tex }, marks)];
    case "break":
      return [marks.length ? { type: "hardBreak", marks } : { type: "hardBreak" }];
    case "footnoteReference":
      return [atom("footnoteRef", { label: item.label }, marks)];
    case "custom":
      return convertCustom(item, marks);
    default:
      return convertItems(pairTags(item.content), withMark(marks, { type: STYLE_MARK[item.type] }));
  }
}

function convertItems(items: Item[], marks: PMMark[]): PMNode[] {
  return items.flatMap((item) => convertItem(item, marks));
}

/** 解析出的行内内容 → 编辑器行内节点 */
export function inlineToNodes(content: MdInline[]): PMNode[] {
  return convertItems(pairTags(content), []);
}

function paragraph(content: MdInline[]): PMNode {
  const nodes = inlineToNodes(content);
  return nodes.length ? { type: "paragraph", content: nodes } : { type: "paragraph" };
}

const EMPTY_PARAGRAPH: PMNode = { type: "paragraph" };

/** 编辑器要求容器至少有一个块、列表项第一个块是段落 */
function containerContent(children: MdBlock[], paragraphFirst: boolean): PMNode[] {
  const nodes = children.map(blockToNode);
  if (nodes.length === 0 || (paragraphFirst && nodes[0].type !== "paragraph")) return [EMPTY_PARAGRAPH, ...nodes];
  return nodes;
}

function listNode(block: Extract<MdBlock, { type: "list" }>): PMNode {
  const items = block.items;
  const task = !block.ordered && items.length > 0 && items.every((it) => typeof it.checked === "boolean");
  const item = (it: MdListItem): PMNode =>
    task
      ? { type: "taskItem", attrs: { checked: it.checked === true }, content: containerContent(it.children, true) }
      : { type: "listItem", attrs: { checked: it.checked ?? null }, content: containerContent(it.children, true) };
  const type = task ? "taskList" : block.ordered ? "orderedList" : "bulletList";
  const attrs = block.ordered ? { loose: block.loose === true, start: block.start ?? 1 } : { loose: block.loose === true };
  return { type, attrs, content: items.map(item) };
}

function codeNode(block: Extract<MdBlock, { type: "codeBlock" }>): PMNode {
  if (block.language === "mermaid" && !block.meta) return { type: "diagram", attrs: { code: block.code } };
  const attrs = { language: block.language ?? null, meta: block.meta ?? null };
  return block.code ? { type: "codeBlock", attrs, content: [{ type: "text", text: block.code }] } : { type: "codeBlock", attrs };
}

function tableNode(block: Extract<MdBlock, { type: "table" }>): PMNode {
  const rows = [block.head, ...(block.rows ?? [])];
  const cols = Math.max(...rows.map((r) => r.length));
  const alignOf = (c: number): string | null => {
    const a = block.align?.[c];
    return a && a !== "none" ? a : null;
  };
  const row = (cells: { content: MdInline[] }[], cellType: string): PMNode => ({
    type: "tableRow",
    content: Array.from({ length: cols }, (_, c) => ({
      type: cellType,
      attrs: { align: alignOf(c) },
      content: [paragraph(cells[c]?.content ?? [])],
    })),
  });
  return { type: "table", content: [row(block.head, "tableHeader"), ...(block.rows ?? []).map((r) => row(r, "tableCell"))] };
}

function customNode(block: Extract<MdBlock, { type: "custom" }>): PMNode {
  if (block.name === "frontmatter") return { type: "frontmatter", attrs: { yaml: block.text ?? "" } };
  return paragraph([{ type: "text", text: block.text ?? "" }]);
}

function isTocParagraph(block: MdBlock): boolean {
  return block.type === "paragraph" && block.content.length === 1 && block.content[0].type === "custom" && block.content[0].name === "toc";
}

/** 一个解析出的顶层块 → 一个编辑器节点（一一对应，原文切片按这个数节点） */
export function blockToNode(block: MdBlock): PMNode {
  switch (block.type) {
    case "paragraph":
      return isTocParagraph(block) ? { type: "toc" } : paragraph(block.content);
    case "heading": {
      const content = inlineToNodes(block.content);
      return content.length ? { type: "heading", attrs: { level: block.level }, content } : { type: "heading", attrs: { level: block.level } };
    }
    case "blockquote":
      return { type: "blockquote", attrs: { alert: block.alert ?? null }, content: containerContent(block.children, false) };
    case "list":
      return listNode(block);
    case "codeBlock":
      return codeNode(block);
    case "math":
      return { type: "mathBlock", attrs: { tex: block.tex } };
    case "table":
      return tableNode(block);
    case "rule":
      return { type: "horizontalRule" };
    case "details":
      return { type: "blockquote", attrs: { alert: null }, content: [paragraph(block.summary), ...containerContent(block.children, false)] };
    case "custom":
      return customNode(block);
  }
}

/** 原样保留的一段原文 → rawBlock */
export function rawNode(src: string): PMNode {
  return { type: "rawBlock", attrs: { src } };
}
