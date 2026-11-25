/** 选词、选行、选格式范围（Typora 的 Cmd+D / L / E，实施计划 4.4）。只在一个文本块里算：段落、标题、代码块。 */
import { chain, type RichEditorSession, scrollIntoView, setCellSelection, setTextSelection } from "nsh/base";
import type { PMMark, PMNode } from "../../doc/types";
import { reachSelection } from "./caret-follow";
import { eachNode, nodeSize } from "./outline";
import { selectionRange } from "./selection";

const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock"]);
/** 行内原子（图片、公式、脚注引用…）在摊平的文字里占一格，记成这个字符：不算词的一部分。 */
const OBJECT = "￼";

interface Segment {
  from: number;
  to: number;
  marks: PMMark[];
}

/** 一个文本块：内容起点，和按位置一格一个字符摊平的文字（换行记成 \n），以及每个行内节点占的范围和 mark。在表格里时带上整张表的行和自己在第几行。 */
interface TextBlock {
  start: number;
  text: string;
  segments: Segment[];
  rows?: TableRow[];
  row?: number;
}

/** 表格的一行：每个格子前面的位置，和这一行结束的位置。 */
interface TableRow {
  cells: number[];
  end: number;
}

function flatten(block: PMNode, start: number): TextBlock {
  let pos = start;
  let text = "";
  const segments: Segment[] = [];
  for (const child of block.content ?? []) {
    const own = child.type === "text" ? (child.text ?? "") : child.type === "hardBreak" ? "\n" : OBJECT;
    text += own;
    segments.push({ from: pos, to: pos + own.length, marks: child.marks ?? [] });
    pos += own.length;
  }
  return { start, text, segments };
}

function tableRows(table: PMNode, pos: number): TableRow[] {
  const rows: TableRow[] = [];
  let at = pos + 1;
  for (const r of table.content ?? []) {
    const cells: number[] = [];
    let p = at + 1;
    for (const c of r.content ?? []) {
      cells.push(p);
      p += nodeSize(c);
    }
    at += nodeSize(r);
    rows.push({ cells, end: at });
  }
  return rows;
}

function textBlocks(session: RichEditorSession): TextBlock[] {
  const out: TextBlock[] = [];
  let rows: TableRow[] = [];
  eachNode(session.getJSON() as PMNode, (node, pos) => {
    if (node.type === "table") rows = tableRows(node as PMNode, pos);
    if (!TEXTBLOCKS.has(node.type)) return;
    const row = rows.findIndex((r) => r.cells[0] < pos && pos < r.end);
    out.push(row < 0 ? flatten(node as PMNode, pos + 1) : { ...flatten(node as PMNode, pos + 1), rows, row });
    return false;
  });
  return out;
}

const endOf = (b: TextBlock) => b.start + b.text.length;
const blockAt = (blocks: TextBlock[], pos: number) => blocks.find((b) => pos >= b.start && pos <= endOf(b));

function select(session: RichEditorSession, from: number, to: number) {
  session.run(chain([setTextSelection(from, to), scrollIntoView()]));
  reachSelection();
}

/** 分词器：Intl.Segmenter 的形状。可以从外面传进 `wordAround`（测试里用替身走有分词器的那条路）。 */
export type Segmenter = { segment(text: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }> };
const SegmenterClass = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: "word" }) => Segmenter }).Segmenter;
const segmenter: Segmenter | null = SegmenterClass ? new SegmenterClass(undefined, { granularity: "word" }) : null;

/** 词中间的撇号（don't、l’homme）算词的一部分。 */
const APOSTROPHES = new Set(["'", "’"]);

/**
 * 没有 Intl.Segmenter（nsh 0.6.0 的 JS 引擎里就没有，2026-11-25 实测）时按字符种类分：连着的汉字算一个词，连着的字母数字算一个词，连着的 emoji 算一个。
 * 按码点判断：𠮷 这类字、emoji 在字符串里占两格（代理对），拆开单看哪一类都不是。
 */
function charClass(c: string): string {
  if (/\p{Script=Han}/u.test(c)) return "han";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(c)) return "kana";
  if (/[\p{L}\p{N}\p{M}_]/u.test(c)) return "word";
  if (/[\p{Extended_Pictographic}\u200d\ufe0f\u{1f3fb}-\u{1f3ff}]/u.test(c)) return "emoji";
  return "";
}

const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;
const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
/** 从 `i` 开始的那个码点。 */
const charFrom = (text: string, i: number) => String.fromCodePoint(text.codePointAt(i) ?? 0);
/** 在 `i` 之前结束的那个码点的起点。 */
const prevStart = (text: string, i: number) => (i >= 2 && isLow(text.charCodeAt(i - 1)) && isHigh(text.charCodeAt(i - 2)) ? i - 2 : i - 1);

/** `at` 处（按码点）的那一串同类字符的两端。 */
function runAround(text: string, at: number): [number, number] | null {
  if (at < 0 || at >= text.length) return null;
  const start = at > 0 && isLow(text.charCodeAt(at)) && isHigh(text.charCodeAt(at - 1)) ? at - 1 : at;
  const kind = charClass(charFrom(text, start));
  if (!kind) return null;
  const same = (i: number) => i >= 0 && i < text.length && charClass(charFrom(text, i)) === kind;
  let a = start;
  for (;;) {
    if (a === 0) break;
    const p = prevStart(text, a);
    if (same(p)) a = p;
    else if (kind === "word" && APOSTROPHES.has(text[p]) && p > 0 && same(prevStart(text, p))) a = p;
    else break;
  }
  let b = start + charFrom(text, start).length;
  while (b < text.length) {
    if (same(b)) b += charFrom(text, b).length;
    else if (kind === "word" && APOSTROPHES.has(text[b]) && same(b + 1)) b += 1;
    else break;
  }
  return [a, b];
}

/** 摊平文字里 `offset` 处的词（含它，或者紧挨在它前面的）的两端；不在词上是 null。`seg` 默认用运行环境的 Intl.Segmenter，没有就按字符种类分。 */
export function wordAround(text: string, offset: number, seg: Segmenter | null = segmenter): [number, number] | null {
  if (!seg) return runAround(text, offset) ?? (offset > 0 ? runAround(text, prevStart(text, offset)) : null);
  let before: [number, number] | null = null;
  for (const s of seg.segment(text)) {
    const end = s.index + s.segment.length;
    if (!s.isWordLike || s.segment.includes(OBJECT)) continue;
    if (s.index <= offset && offset < end) return [s.index, end];
    if (end === offset) before = [s.index, end];
  }
  return before;
}

/** `text` 里 index 起、长 `length` 的这一段正好是一个完整的词。 */
function isWholeWord(text: string, index: number, length: number): boolean {
  const w = wordAround(text, index);
  return !!w && w[0] === index && w[1] === index + length;
}

/** `needle` 在 `after` 之后下一次出现的位置；到文末没找到就从头接着找。`whole`：只认完整的词（foo 不匹配 food 里的 foo）。 */
function findNext(blocks: TextBlock[], needle: string, after: number, whole: boolean): number | null {
  const i = Math.max(0, blocks.findIndex((b) => after <= endOf(b)));
  const order = [...blocks.slice(i), ...blocks.slice(0, i + 1)];
  for (let k = 0; k < order.length; k++) {
    const b = order[k];
    let index = b.text.indexOf(needle, k === 0 ? after - b.start : 0);
    while (index >= 0 && whole && !isWholeWord(b.text, index, needle.length)) index = b.text.indexOf(needle, index + 1);
    if (index >= 0) return b.start + index;
  }
  return null;
}

/**
 * 没有选区时选中光标所在的词；已经选了一段文字时选中它下一次出现的地方（再按再往下找）。
 * 选中的正好是一个词（由选词进来的）时只找完整的词；区分大小写，和 Typora、VS Code 的默认一样。
 */
export function selectWord(session: RichEditorSession) {
  const blocks = textBlocks(session);
  const { from, to } = selectionRange(session);
  const b = blockAt(blocks, from);
  if (!b) return;
  if (from === to) {
    const word = wordAround(b.text, from - b.start);
    if (word) select(session, b.start + word[0], b.start + word[1]);
    return;
  }
  if (to > endOf(b)) return;
  const needle = b.text.slice(from - b.start, to - b.start);
  const next = findNext(blocks, needle, to, isWholeWord(b.text, from - b.start, needle.length));
  if (next !== null) select(session, next, next + needle.length);
}

const lineStart = (text: string, offset: number) => text.lastIndexOf("\n", offset - 1) + 1;
function lineEnd(text: string, offset: number) {
  const at = text.indexOf("\n", offset);
  return at < 0 ? text.length : at;
}

/** 已经选到 `to` 所在行的行尾时，下一行的行尾（同一块里的下一行，或下一个文本块的第一行）。 */
function nextLineEnd(blocks: TextBlock[], to: number): number | null {
  const b = blockAt(blocks, to);
  if (!b) return null;
  const offset = to - b.start;
  if (offset < b.text.length) return b.start + lineEnd(b.text, offset + 1);
  const next = blocks[blocks.indexOf(b) + 1];
  return next ? next.start + lineEnd(next.text, 0) : null;
}

/** 选中表格的整行：从 `anchorCell` 那一格到第 `row` 行的最后一格。 */
function selectRows(session: RichEditorSession, anchorCell: number, row: TableRow) {
  session.run(chain([setCellSelection({ anchorCell, headCell: row.cells[row.cells.length - 1] }), scrollIntoView()]));
}

/** 已经是单元格选区：往下多选一行。 */
function extendRows(session: RichEditorSession, blocks: TextBlock[], anchor: number, head: number) {
  const rows = blocks.find((b) => b.rows?.some((r) => r.cells.includes(head)))?.rows;
  const at = rows?.findIndex((r) => r.cells.includes(head)) ?? -1;
  const next = rows?.[at + 1];
  if (next) selectRows(session, anchor, next);
}

/**
 * 选中光标所在的一行（段落里按换行分）；已经选中整行时再往下多选一行。
 * 表格里：先选格子里的这一行，再按选中整个表格行，之后一行一行往下加。空行上什么也不选（不往下一块跑）。
 */
export function selectLine(session: RichEditorSession) {
  const blocks = textBlocks(session);
  const sel = session.selection;
  if (sel.type === "cell") return extendRows(session, blocks, sel.anchor ?? 0, sel.head ?? sel.anchor ?? 0);
  const { from, to } = selectionRange(session);
  const first = blockAt(blocks, from);
  const last = blockAt(blocks, to);
  if (!first || !last) return;
  const lineFrom = first.start + lineStart(first.text, from - first.start);
  const lineTo = last.start + lineEnd(last.text, to - last.start);
  if (from !== lineFrom || to !== lineTo) return select(session, lineFrom, lineTo);
  if (from === to) return;
  if (last.rows && last.row !== undefined) {
    if (first === last && to === endOf(last)) selectRows(session, last.rows[last.row].cells[0], last.rows[last.row]);
    else if (to < endOf(last)) select(session, from, last.start + lineEnd(last.text, to - last.start + 1));
    return;
  }
  const next = nextLineEnd(blocks, to);
  if (next !== null) select(session, from, next);
}

function sameMark(a: PMMark, b: PMMark): boolean {
  return a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
}

/** 碰到选区的每个 mark 往两边连着的节点延伸，得到这个 mark 盖住的整段。 */
function markRanges(b: TextBlock, from: number, to: number): [number, number][] {
  const segs = b.segments;
  const has = (i: number, m: PMMark) => i >= 0 && i < segs.length && segs[i].marks.some((x) => sameMark(x, m));
  const out: [number, number][] = [];
  segs.forEach((seg, i) => {
    if (seg.to < from || seg.from > to) return;
    for (const m of seg.marks) {
      let a = i;
      let z = i;
      while (has(a - 1, m)) a--;
      while (has(z + 1, m)) z++;
      out.push([segs[a].from, segs[z].to]);
    }
  });
  return out;
}

/** 选中光标所在的格式范围：最小的、比现在的选区大的那段粗体 / 链接 / 代码…；都没有时选中整个文本块。 */
export function selectFormat(session: RichEditorSession) {
  const blocks = textBlocks(session);
  const { from, to } = selectionRange(session);
  const b = blockAt(blocks, from);
  if (!b || to > endOf(b)) return;
  const best = [...markRanges(b, from, to), [b.start, endOf(b)] as [number, number]]
    .filter(([a, z]) => a <= from && to <= z && z - a > to - from)
    .sort((x, y) => x[1] - x[0] - (y[1] - y[0]))[0];
  if (best) select(session, best[0], best[1]);
}
