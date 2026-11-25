/** 「复制为 Markdown」：把编辑器 JSON 里 from..to 这一段剪出来，写成 Markdown（改写过的块按固定写法，不是原文切片）。 */
import { blockToMarkdown, isEmptyParagraph, listOptions, writeInline } from "./to-markdown";
import type { PMNode } from "./types";

const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock"]);
const LISTS = new Set(["bulletList", "orderedList", "taskList"]);
const ITEMS = new Set(["listItem", "taskItem"]);

/** ProseMirror 的 nodeSize：文字按 UTF-16 长度，没有内容的文本块 2，其余叶子 1。 */
function sizeOf(node: PMNode): number {
  if (node.type === "text") return (node.text ?? "").length;
  if (!node.content) return TEXTBLOCKS.has(node.type) ? 2 : 1;
  return node.content.reduce((sum, child) => sum + sizeOf(child), 2);
}

/** 剪完还有没有东西：有字或者有行内原子（图片、公式…）。只剩空壳的块（选区刚好停在下一块开头）不写。 */
function hasContent(node: PMNode): boolean {
  if (node.type === "text") return (node.text ?? "") !== "";
  if (!node.content) return !TEXTBLOCKS.has(node.type);
  return node.content.some(hasContent);
}


/** 内容从 `start` 开始的一串节点里，和 from..to 相交的部分；整个落在里面的节点原样保留，只盖住一部分的往里剪。 */
function cutNodes(nodes: PMNode[], start: number, from: number, to: number): PMNode[] {
  const out: PMNode[] = [];
  let pos = start;
  for (const node of nodes) {
    const end = pos + sizeOf(node);
    if (end > from && pos < to) out.push(...cutNode(node, pos, end, from, to));
    pos = end;
  }
  return out;
}

function cutNode(node: PMNode, pos: number, end: number, from: number, to: number): PMNode[] {
  if (pos >= from && end <= to) return [node];
  if (node.type === "text") return [{ ...node, text: (node.text ?? "").slice(Math.max(from, pos) - pos, Math.min(to, end) - pos) }];
  if (!node.content) return [];
  if (node.type === "table") return [touchedRows(node, pos + 1, from, to)];
  const content = cutNodes(node.content, pos + 1, from, to);
  if (!content.some(hasContent)) return [];
  // 这一项自己的那行没选上、只选了它下面的子列表：只写被选中的那一层，不套这一项的列表符号（不然是 `- - b`）
  if (ITEMS.has(node.type) && !touches(node.content[0], pos + 1, from, to)) return content;
  if (LISTS.has(node.type)) return splitList(node, content, skippedItems(node, pos + 1, from));
  return [{ ...node, content }];
}

const touches = (first: PMNode | undefined, start: number, from: number, to: number) => !!first && start + sizeOf(first) > from && start < to;

function skippedItems(list: PMNode, start: number, from: number): number {
  let pos = start;
  let n = 0;
  for (const item of list.content ?? []) {
    const end = pos + sizeOf(item);
    if (end > from) break;
    n++;
    pos = end;
  }
  return n;
}

/**
 * 剪过的列表：连着的项还是这个列表，项里提出来的子列表单独成块。
 * 有序列表的起始序号接着原来的数（前面没选上的项也算），不然第 3、4 项会写成 1. 2.。
 */
function splitList(list: PMNode, content: PMNode[], skipped: number): PMNode[] {
  const base = Number(list.attrs?.start ?? 1) + skipped;
  const out: PMNode[] = [];
  let run: PMNode[] = [];
  let done = 0;
  const flush = () => {
    if (run.length === 0) return;
    out.push(list.type === "orderedList" ? { ...list, attrs: { ...list.attrs, start: base + done }, content: run } : { ...list, content: run });
    done += run.length;
    run = [];
  };
  for (const n of content) {
    if (ITEMS.has(n.type)) run.push(n);
    else {
      flush();
      out.push(n);
    }
  }
  flush();
  return out;
}

/** 跨块选区里只盖住一部分的表格：写碰到的整行，表头行总是带上（Markdown 表格没有表头就不是表格），列不会错位。 */
function touchedRows(table: PMNode, start: number, from: number, to: number): PMNode {
  const rows = table.content ?? [];
  let pos = start;
  const kept = rows.filter((row, i) => {
    const end = pos + sizeOf(row);
    const hit = i === 0 || (end > from && pos < to);
    pos = end;
    return hit;
  });
  return { ...table, content: kept };
}

/** from 和 to 落在同一个文本块里时，这个块和它内容的起点。 */
function sharedTextblock(nodes: PMNode[], start: number, from: number, to: number): { node: PMNode; start: number } | null {
  let pos = start;
  for (const node of nodes) {
    const end = pos + sizeOf(node);
    if (from > pos && to < end) {
      if (TEXTBLOCKS.has(node.type)) return { node, start: pos + 1 };
      return node.content ? sharedTextblock(node.content, pos + 1, from, to) : null;
    }
    pos = end;
  }
  return null;
}

/** from 和 to 都在同一张表格里（跨了单元格）时，这张表格和它内容的起点。 */
function sharedTable(nodes: PMNode[], start: number, from: number, to: number): { node: PMNode; start: number } | null {
  let pos = start;
  for (const node of nodes) {
    const end = pos + sizeOf(node);
    if (from > pos && to < end) {
      if (node.type === "table") return { node, start: pos + 1 };
      return node.content ? sharedTable(node.content, pos + 1, from, to) : null;
    }
    pos = end;
  }
  return null;
}

const plainText = (node: PMNode): string => (node.type === "text" ? (node.text ?? "") : node.type === "hardBreak" ? "\n" : (node.content ?? []).map(plainText).join(""));

/** 表格里跨单元格的选区：写成选中单元格的文字，同一行的格子用制表符隔开、行之间换行（和表格软件复制出来的一样）。 */
function cellsText(table: PMNode, start: number, from: number, to: number): string {
  return cutNodes(table.content ?? [], start, from, to)
    .map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).map(plainText).join(" ")).join("\t"))
    .join("\n");
}

interface CellAt {
  table: PMNode;
  row: number;
  col: number;
}

/** 位置 `cellPos`（单元格前面）在哪张表格的第几行第几列。 */
function cellAt(nodes: PMNode[], start: number, cellPos: number): CellAt | null {
  let pos = start;
  for (const node of nodes) {
    const end = pos + sizeOf(node);
    if (cellPos > pos && cellPos < end) {
      if (node.type !== "table") return node.content ? cellAt(node.content, pos + 1, cellPos) : null;
      let rowPos = pos + 1;
      for (const [row, r] of (node.content ?? []).entries()) {
        let p = rowPos + 1;
        for (const [col, c] of (r.content ?? []).entries()) {
          if (p === cellPos) return { table: node, row, col };
          p += sizeOf(c);
        }
        rowPos += sizeOf(r);
      }
      return null;
    }
    pos = end;
  }
  return null;
}

/** 单元格选区（拖过几个格子、Shift+方向键跨格）：选中的那一块格子的文字，格子之间制表符，行之间换行。两个位置是锚点格和另一头那一格前面的位置。 */
export function cellSelectionText(doc: PMNode, anchorCell: number, headCell: number): string {
  const a = cellAt(doc.content ?? [], 0, anchorCell);
  const b = cellAt(doc.content ?? [], 0, headCell);
  if (!a || !b || a.table !== b.table) return "";
  const [r1, r2] = [Math.min(a.row, b.row), Math.max(a.row, b.row)];
  const [c1, c2] = [Math.min(a.col, b.col), Math.max(a.col, b.col)];
  return (a.table.content ?? [])
    .slice(r1, r2 + 1)
    .map((row) => (row.content ?? []).slice(c1, c2 + 1).map((cell) => (cell.content ?? []).map(plainText).join(" ")).join("\t"))
    .join("\n");
}

function writeBlocks(nodes: PMNode[]): string {
  const parts: string[] = [];
  let prev: PMNode | null = null;
  for (const node of nodes) {
    if (isEmptyParagraph(node)) continue;
    const text = blockToMarkdown(node, { ...listOptions(node, prev, parts[parts.length - 1] ?? ""), first: prev === null });
    if (text === "") continue;
    parts.push(text);
    prev = node;
  }
  return parts.join("\n\n");
}

/** 一段行内内容：首尾的空格、Tab 原样留在外面（整篇写出时为了不被解析器吃掉会换成 `&#32;`，复制出来的片段不需要）。 */
function inlineFragment(nodes: PMNode[]): string {
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const lead = first?.type === "text" ? (/^[ \t]+/.exec(first.text ?? "")?.[0] ?? "") : "";
  const trail = last?.type === "text" && (last !== first || lead.length < (last.text ?? "").length) ? (/[ \t]+$/.exec(last.text ?? "")?.[0] ?? "") : "";
  const inner = nodes
    .map((n, i) => {
      if (n.type !== "text") return n;
      const text = n.text ?? "";
      return { ...n, text: text.slice(i === 0 ? lead.length : 0, n === last ? text.length - trail.length : text.length) };
    })
    .filter((n) => n.type !== "text" || n.text !== "");
  return lead + writeInline(inner) + trail;
}

/** 选区 from..to（文档位置）对应的 Markdown。选区在一个文本块里时只写行内部分（代码块里是代码本身），跨块时按块写。 */
export function selectionMarkdown(doc: PMNode, from: number, to: number): string {
  const nodes = doc.content ?? [];
  const shared = sharedTextblock(nodes, 0, from, to);
  if (shared) {
    const inline = cutNodes(shared.node.content ?? [], shared.start, from, to);
    return shared.node.type === "codeBlock" ? inline.map((n) => n.text ?? "").join("") : inlineFragment(inline);
  }
  const table = sharedTable(nodes, 0, from, to);
  if (table) return cellsText(table.node, table.start, from, to);
  return writeBlocks(cutNodes(nodes, 0, from, to));
}
