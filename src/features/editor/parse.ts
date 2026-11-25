import { TextView } from "nsh/base";
import { splitEndings } from "../../doc/line-endings";
import { defLabelOf, defLinesIn, scanLabels } from "../../doc/save";
import type { MdBlock, ParsedSource, SourceSlice } from "../../doc/types";

const OPTIONS = { math: true, html: false, alerts: true };
// html 关掉：nsh 0.6.0 开着 html 时会丢掉不认识的行内标签（<span>、注释），关掉后标签作为文字留下，由 html 模式原样取回
const EXTENSIONS = [
  // 两头不能是空白：正文里的 a == b or c == d 不是高亮
  { name: "hl", pattern: "==([^=\\s](?:[^=\\n]*[^=\\s])?)==" },
  { name: "toc", pattern: "^\\[(?i:toc)\\]$" },
  { name: "html", pattern: "<!--[\\s\\S]*?-->|</?[A-Za-z][A-Za-z0-9-]*(?:\\s[^<>]*)?/?>" },
];

/**
 * Typora 的下标 `~x~`、上标 `^x^`：中间不能有空白和别的 Markdown 记号，前面不能是没转义的同一个记号（或 `[`，那是脚注 `[^1]`）。
 * nsh 0.6.0 的解析器把单个 ~ 也当删除线（GFM 的写法），扩展模式又只在解析完的文字上匹配（`\~x\~` 转义完也会命中），
 * 所以解析前先把这些成对的记号换成私用区的同宽字符，扩展只认它们；解析完再把所有字符串里的换回来（2026-11-25 实测）。
 */
const SCRIPT_PAIR = /([~^])(?<=(?:^|[^\\~^[])(?:\\\\)*[~^])([^\s~^*_`[\]\\<>$=&!|]+)\1(?!\1)/gm;
const SCRIPT_CHAR: Record<string, string> = { "~": "\uE000", "^": "\uE001" };
const SCRIPT_BACK: Record<string, string> = { "\uE000": "~", "\uE001": "^" };
const SCRIPT_EXTENSIONS = [
  { name: "sub", pattern: "\uE000([^\uE000]+)\uE000" },
  { name: "sup", pattern: "\uE001([^\uE001]+)\uE001" },
];

/** 把成对的 ~x~、^x^ 换成私用区字符；原文里本来就有这两个字符时不换（换回来会分不清）。没有可换的返回 null。 */
function markScripts(text: string): string | null {
  if (/[\uE000\uE001]/.test(text) || !/[~^]/.test(text)) return null;
  const out = text.replace(SCRIPT_PAIR, (_m, ch: string, body: string) => SCRIPT_CHAR[ch] + body + SCRIPT_CHAR[ch]);
  return out === text ? null : out;
}

function unmarkScripts(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/[\uE000\uE001]/g, (c) => SCRIPT_BACK[c]);
  if (Array.isArray(value)) return value.map(unmarkScripts);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unmarkScripts(v)]));
  return value;
}

/** 补在候选段前的定义之后，用来结束脚注定义的续段，免得把段首的缩进代码吃进脚注 */
const SENTINEL = "[nsh-md-slice-sentinel]: #";
// 合并上限：块感知的切分下合并很少见；超过就退到「从这里到文末一个切片」。预算留出余量给建会话（单次 JS 调用 2000ms 上限）
const MAX_MERGE = 40;
/** 批量解析时隔开候选段的段落：前后空行能结束列表、引用、脚注续段和缩进代码 */
const MARKER = "nsh-md-slice-marker-6b1f";
const BATCH = 64;
const SLICE_BUDGET_MS = 1200;
const MAX_HTML_LINES = 2000;

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const QUOTE = /^ {0,3}>/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const LIST_ITEM = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]*)(.*)$/;
const BLOCK_TAGS =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const CONTAINER_TAGS = new Set(["details", "div", "table", "figure", "section", "article", "aside", "center", "blockquote", "dl", "ul", "ol", "nav", "header", "footer", "main", "form", "fieldset", "dialog"]);
const HTML_START: [RegExp, RegExp | null][] = [
  [/^ {0,3}<(?:script|pre|style|textarea)(?:[\s>]|$)/i, /<\/(?:script|pre|style|textarea)>/i],
  [/^ {0,3}<!--/, /-->/],
  [/^ {0,3}<\?/, /\?>/],
  [/^ {0,3}<![A-Za-z]/, />/],
  [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
  [new RegExp(`^ {0,3}</?(?:${BLOCK_TAGS})(?:[\\s/>]|$)`, "i"), null],
];
const HTML_LONE_TAG = /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)[ \t]*$/;

interface Chunk {
  start: number;
  end: number;
  raw: boolean;
}

interface ListInfo {
  kind: string;
  content: number;
  empty: boolean;
  marker: string;
}

function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function indentOf(line: string): number {
  let n = 0;
  for (const c of line) {
    if (c === " ") n++;
    else if (c === "\t") n += 4 - (n % 4);
    else break;
  }
  return n;
}

function fenceOf(line: string): { ch: string; len: number } | null {
  const m = FENCE.exec(line);
  if (!m || (m[2][0] === "`" && m[3].includes("`"))) return null;
  return { ch: m[2][0], len: m[2].length };
}

function listItemOf(line: string): ListInfo | null {
  if (HR.test(line)) return null;
  const m = LIST_ITEM.exec(line);
  if (!m || (m[3] === "" && m[4] !== "")) return null;
  const base = m[1].length + m[2].length;
  const empty = m[4] === "";
  const content = empty || m[3].length >= 5 ? base + 1 : base + m[3].length;
  return { kind: /\d/.test(m[2]) ? m[2].slice(-1) : m[2], content, empty, marker: m[2] };
}

/** HTML 块的种类（CommonMark 的 1–7）；7 不能打断段落 */
function htmlKind(line: string, atStart: boolean): number {
  const k = HTML_START.findIndex(([re]) => re.test(line));
  if (k >= 0) return k + 1;
  return atStart && HTML_LONE_TAG.test(line) ? 7 : 0;
}

/** 能打断段落的行，首个非空字符只可能是这些 */
const MAY_INTERRUPT = /^ {0,3}[#>*+\-_`~<$0-9]/;

function interrupts(line: string): boolean {
  if (!MAY_INTERRUPT.test(line)) return false;
  if (ATX.test(line) || QUOTE.test(line) || HR.test(line) || fenceOf(line) || line.trim() === "$$" || htmlKind(line, false) > 0) return true;
  const li = listItemOf(line);
  return !!li && !li.empty && (!/\d/.test(li.marker) || /^1[.)]$/.test(li.marker));
}

function untilBlank(lines: string[], from: number): number {
  let j = from;
  while (j < lines.length && !isBlank(lines[j])) j++;
  return j;
}

function lastNonBlankEnd(lines: string[], from: number, to: number): number {
  let end = to;
  while (end > from + 1 && isBlank(lines[end - 1])) end--;
  return end;
}

function fenceEnd(lines: string[], i: number, f: { ch: string; len: number }): number {
  const close = new RegExp(`^ {0,3}\\${f.ch}{${f.len},}[ \\t]*$`);
  for (let j = i + 1; j < lines.length; j++) if (close.test(lines[j])) return j + 1;
  return lastNonBlankEnd(lines, i, lines.length);
}

function matchingClose(lines: string[], i: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*?(/?)>`, "gi");
  let depth = 0;
  for (let j = i; j < Math.min(lines.length, i + MAX_HTML_LINES); j++) {
    for (const m of lines[j].matchAll(re)) {
      if (m[2] === "/") continue;
      depth += m[1] === "/" ? -1 : 1;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function htmlEnd(lines: string[], i: number, kind: number): number {
  const endRe = kind <= 5 ? HTML_START[kind - 1][1] : null;
  if (endRe) {
    const from = kind === 2 ? lines[i].indexOf("<!--") + 4 : 0;
    if (endRe.test(lines[i].slice(from))) return i + 1;
    for (let j = i + 1; j < lines.length; j++) if (endRe.test(lines[j])) return j + 1;
    return lastNonBlankEnd(lines, i, lines.length);
  }
  const tag = /^ {0,3}<([A-Za-z][A-Za-z0-9-]*)/.exec(lines[i])?.[1].toLowerCase();
  const close = kind === 6 && tag && CONTAINER_TAGS.has(tag) ? matchingClose(lines, i, tag) : -1;
  return untilBlank(lines, close >= 0 ? close + 1 : i + 1);
}

function linkDefEnd(lines: string[], i: number): number {
  let j = i + 1;
  while (j < lines.length && !isBlank(lines[j]) && defLabelOf(lines[j]) === null && /^(?:[ \t]+\S|["'(<])/.test(lines[j])) j++;
  return j;
}

/** 脚注定义：首段的懒续行，加上空行之后缩进 4 格的续段（实测缩进 2 格不算续段） */
function footnoteDefEnd(lines: string[], i: number): number {
  let last = i;
  let j = i + 1;
  while (j < lines.length) {
    if (isBlank(lines[j])) {
      let k = j;
      while (k < lines.length && isBlank(lines[k])) k++;
      if (k >= lines.length || indentOf(lines[k]) < 4) break;
      j = k;
    } else if (indentOf(lines[j]) < 4 && (defLabelOf(lines[j]) !== null || interrupts(lines[j]))) break;
    last = j;
    j++;
  }
  return last + 1;
}

function mathEnd(lines: string[], i: number): number {
  const first = lines[i].trim();
  if (!first.startsWith("$$") || (first.length > 2 && first.endsWith("$$"))) return -1;
  for (let j = i + 1; j < lines.length; j++) if (lines[j].trim().endsWith("$$")) return j + 1;
  return -1;
}

function listEnd(lines: string[], i: number, first: ListInfo): number {
  let content = first.content;
  let last = i;
  let blank = false;
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j];
    if (isBlank(line)) {
      blank = true;
      continue;
    }
    const li = indentOf(line) >= content ? null : listItemOf(line);
    if (indentOf(line) >= content || (li && li.kind === first.kind)) {
      content = li ? li.content : content;
      last = j;
      blank = false;
      continue;
    }
    if (li || blank || interrupts(line)) break;
    last = j;
  }
  return last + 1;
}

function indentedEnd(lines: string[], i: number): number {
  let last = i;
  for (let j = i + 1; j < lines.length; j++) {
    if (isBlank(lines[j])) continue;
    if (indentOf(lines[j]) < 4) break;
    last = j;
  }
  return last + 1;
}

function paraEnd(lines: string[], i: number): number {
  const quote = QUOTE.test(lines[i]);
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j];
    if (isBlank(line)) return j;
    if (!quote && SETEXT.test(line)) return j + 1;
    if (quote && QUOTE.test(line)) continue;
    if (interrupts(line)) return j;
  }
  return lines.length;
}

function frontMatterEnd(lines: string[]): number {
  if (lines[0] !== "---") return -1;
  const close = lines.indexOf("---", 1);
  return close > 0 ? close + 1 : -1;
}

/** 按行首特征切出一个候选块：围栏、$$、front matter、HTML 块、定义、列表、缩进代码都按自己的结束规则整块拿走 */
function chunkAt(lines: string[], i: number): Chunk {
  const line = lines[i];
  const fm = i === 0 ? frontMatterEnd(lines) : -1;
  if (fm > 0) return { start: 0, end: fm, raw: false };
  const fence = fenceOf(line);
  if (fence) return { start: i, end: fenceEnd(lines, i, fence), raw: false };
  const html = htmlKind(line, true);
  if (html) return { start: i, end: htmlEnd(lines, i, html), raw: true };
  const label = defLabelOf(line);
  if (label !== null) return { start: i, end: label.startsWith("^") ? footnoteDefEnd(lines, i) : linkDefEnd(lines, i), raw: true };
  const math = mathEnd(lines, i);
  if (math > 0) return { start: i, end: math, raw: false };
  const li = listItemOf(line);
  if (li) return { start: i, end: listEnd(lines, i, li), raw: false };
  if (indentOf(line) >= 4) return { start: i, end: indentedEnd(lines, i), raw: false };
  if (ATX.test(line) || HR.test(line)) return { start: i, end: i + 1, raw: false };
  return { start: i, end: paraEnd(lines, i), raw: false };
}

/** 引用块、列表项里嵌套了定义行：整块原样保留，否则重写这一块时定义行会丢（解析结果里没有它） */
function holdsDefinition(lines: string[], c: Chunk): boolean {
  if (c.raw || fenceOf(lines[c.start]) || (indentOf(lines[c.start]) >= 4 && !listItemOf(lines[c.start]))) return false;
  const span = lines.slice(c.start, c.end);
  return span.some((l) => l.includes("]:")) && defLinesIn(span.join("\n")).length > 0;
}

function scanChunks(lines: string[]): Chunk[] {
  const out: Chunk[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i++;
      continue;
    }
    const c = chunkAt(lines, i);
    out.push(holdsDefinition(lines, c) ? { ...c, raw: true } : c);
    i = Math.max(c.end, i + 1);
  }
  return out;
}

function isPositional(key: string): boolean {
  return key === "anchor" || key === "index";
}

/** 比较两个解析结果，忽略随位置变化的 anchor（重名标题的序号）和 index（脚注序号）。不分配内存：每次打开要比上万个块 */
function sameTree(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let k = 0; k < a.length; k++) if (!sameTree(a[k], b[k])) return false;
    return true;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  let n = 0;
  for (const k in ra) {
    if (isPositional(k)) continue;
    n++;
    if (!sameTree(ra[k], rb[k])) return false;
  }
  for (const k in rb) if (!isPositional(k)) n--;
  return n === 0;
}

/** 只带这段文字里可能命中的扩展：模式匹配要花时间（实测 15 万字符整篇解析多花约 50%），没有触发字符时结果相同 */
function extensionsFor(text: string): typeof EXTENSIONS {
  return EXTENSIONS.filter((e) => (e.name === "hl" ? text.includes("==") : e.name === "toc" ? /\[toc\]/i.test(text) : text.includes("<")));
}

function parseBlocks(text: string, frontmatter: boolean): MdBlock[] {
  const marked = markScripts(text);
  if (marked === null) return TextView.parse(text, { ...OPTIONS, frontmatter }, extensionsFor(text)).blocks as unknown as MdBlock[];
  const blocks = TextView.parse(marked, { ...OPTIONS, frontmatter }, [...extensionsFor(marked), ...SCRIPT_EXTENSIONS]).blocks;
  return unmarkScripts(blocks) as MdBlock[];
}

interface Source {
  text: string;
  lineStart: number[];
  lineEnd: number[];
  chunks: Chunk[];
}

function spanText(src: Source, i: number, j: number): string {
  return src.text.slice(src.lineStart[src.chunks[i].start], src.lineEnd[src.chunks[j].end - 1]);
}

function sepAfter(src: Source, j: number): string {
  const next = src.chunks[j + 1];
  return src.text.slice(src.lineEnd[src.chunks[j].end - 1], next ? src.lineStart[next.start] : src.text.length);
}

/** 标签 → 补在候选段前面的定义原文：顶层定义取整块（含续行），嵌套的取去掉容器前缀的那一行 */
function definitions(src: Source): Map<string, string> {
  const defs = new Map<string, string>();
  src.chunks.forEach((c, i) => {
    if (!c.raw) return;
    const text = spanText(src, i, i);
    const topLevel = defLabelOf(text.slice(0, src.lineEnd[c.start] - src.lineStart[c.start])) !== null;
    for (const { label, line } of defLinesIn(text)) if (!defs.has(label)) defs.set(label, topLevel ? text : line);
  });
  return defs;
}

/** 候选段单独解析：把它用到的定义补在前面（隔开，不影响列表松紧） */
function parseChunk(text: string, atStart: boolean, defs: Map<string, string>): MdBlock[] {
  const used = defs.size === 0 ? [] : scanLabels(text).flatMap((l) => defs.get(l) ?? []);
  if (used.length === 0) return parseBlocks(text, atStart);
  return parseBlocks(`${[...new Set(used)].join("\n\n")}\n\n${SENTINEL}\n\n${text}`, false);
}

function makeSlice(text: string, sep: string, raw: boolean, blocks: MdBlock[]): SourceSlice {
  const kind = raw || blocks.length === 0 ? "raw" : "parsed";
  return { text, sep, kind, blocks: kind === "raw" ? [] : blocks, labels: scanLabels(text) };
}

function matchesAt(blocks: MdBlock[], whole: MdBlock[], at: number): boolean {
  return blocks.length <= whole.length - at && blocks.every((b, k) => sameTree(b, whole[at + k]));
}

/** 从第 i 段起逐段合并，直到单独解析的结果和整篇的块序列对上；合并超过上限或超时返回 null */
function mergeFrom(src: Source, i: number, whole: MdBlock[], bi: number, defs: Map<string, string>, deadline: number): { j: number; blocks: MdBlock[] } | null {
  const last = src.chunks.length - 1;
  for (let j = i; j <= last && j - i < MAX_MERGE && Date.now() < deadline; j++) {
    const blocks = parseChunk(spanText(src, i, j), src.chunks[i].start === 0, defs);
    if (matchesAt(blocks, whole, bi)) return { j, blocks };
  }
  return null;
}

function isMarker(block: MdBlock): boolean {
  if (block.type !== "paragraph" || block.content.length !== 1) return false;
  const only = block.content[0];
  return only.type === "text" && only.text === MARKER;
}

/** 一批候选段用标记段落隔开一起解析（省掉逐段调用的开销），再按标记拆回每段的块；标记数对不上（比如某段的围栏没闭合）返回 null */
function parseBatch(src: Source, i: number, j: number, defs: Map<string, string>): MdBlock[][] | null {
  const texts = Array.from({ length: j - i + 1 }, (_, k) => spanText(src, i + k, i + k));
  const blocks = parseChunk(texts.join(`\n\n${MARKER}\n\n`), src.chunks[i].start === 0, defs);
  const groups: MdBlock[][] = [[]];
  for (const b of blocks) {
    if (isMarker(b)) groups.push([]);
    else groups[groups.length - 1].push(b);
  }
  return groups.length === texts.length ? groups : null;
}

/** 分段再验证：每个候选段单独解析，和整篇的块序列按顺序比；对不上就和下一段合并再比 */
function verifySlices(src: Source, deadline: number): { slices: SourceSlice[]; degraded: boolean } {
  const whole = parseBlocks(src.text, true);
  const defs = definitions(src);
  const slices: SourceSlice[] = [];
  const last = src.chunks.length - 1;
  let bi = 0;
  let i = 0;
  const take = (j: number, blocks: MdBlock[]): void => {
    slices.push(makeSlice(spanText(src, i, j), sepAfter(src, j), src.chunks.slice(i, j + 1).some((c) => c.raw), blocks));
    bi += blocks.length;
    i = j + 1;
  };
  while (i <= last && Date.now() < deadline) {
    const groups = parseBatch(src, i, Math.min(last, i + BATCH - 1), defs) ?? [];
    let k = 0;
    while (k < groups.length && matchesAt(groups[k], whole, bi)) take(i, groups[k++]);
    if (groups.length > 0 && k === groups.length) continue;
    const merged = mergeFrom(src, i, whole, bi, defs, deadline);
    if (!merged) break;
    take(merged.j, merged.blocks);
  }
  if (i > last && bi === whole.length) return { slices, degraded: false };
  // 第 ⑤ 步：从对不上的地方到文末一个切片；全部段都对上了但块数不齐，说明切法整体不可信，整篇一个切片
  const from = i > last ? 0 : i;
  const head = i > last ? [] : slices;
  const blocks = i > last ? whole : whole.slice(bi);
  const raw = src.chunks.slice(from).some((c) => c.raw);
  return { slices: [...head, makeSlice(spanText(src, from, last), sepAfter(src, last), raw, blocks)], degraded: true };
}

function lineOffsets(text: string): { lines: string[]; lineStart: number[]; lineEnd: number[] } {
  const raw = text.split("\n");
  const lineStart: number[] = [];
  const lineEnd: number[] = [];
  let at = 0;
  for (const line of raw) {
    lineStart.push(at);
    lineEnd.push(at + line.length);
    at += line.length + 1;
  }
  return { lines: raw.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l)), lineStart, lineEnd };
}

function sliceText(text: string, deadline: number): { lead: string; slices: SourceSlice[]; degraded: boolean } {
  const { lines, lineStart, lineEnd } = lineOffsets(text);
  const chunks = scanChunks(lines);
  if (chunks.length === 0) return { lead: text, slices: [], degraded: false };
  const src: Source = { text, lineStart, lineEnd, chunks };
  return { lead: text.slice(0, lineStart[chunks[0].start]), ...verifySlices(src, deadline) };
}

/** Markdown 原文 → 按顺序的顶层块切片（每片带它的原文和后面的空行）。切不准的地方退成大切片，不丢内容、不抛错 */
export function parseMarkdown(src: string): ParsedSource {
  const { bom, crlf, text } = splitEndings(src);
  try {
    return { bom, crlf, ...sliceText(text, Date.now() + SLICE_BUDGET_MS) };
  } catch (error) {
    // 解析器本身出错时整篇当一个原样块，保证不丢内容；错误留在 console 方便排查
    console.warn("parseMarkdown: fell back to one raw slice", error);
    const lead = /^(?:[ \t]*\n)*/.exec(text)?.[0] ?? "";
    const rest = text.slice(lead.length);
    const trail = /\n[ \t\n]*$/.exec(rest)?.[0] ?? "";
    const slices: SourceSlice[] = rest ? [{ text: rest.slice(0, rest.length - trail.length), sep: trail, kind: "raw", blocks: [], labels: [] }] : [];
    return { bom, crlf, lead: rest ? lead : text, slices, degraded: true };
  }
}
