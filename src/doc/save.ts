import { joinEndings } from "./line-endings";
import { blockToNode, rawNode } from "./to-doc";
import { blockToMarkdown, isEmptyParagraph, listOptions } from "./to-markdown";
import type { DocJSON, ParsedSource, PMNode } from "./types";

/** 打开时记下的一段原文切片 */
export interface OriginSlice {
  text: string;
  sep: string;
  /** 这一片在打开时的顶层节点序列里从第几个开始、有几个 */
  first: number;
  count: number;
  labels: string[];
  raw: boolean;
}

/** 打开时的原文信息，还没和编辑器会话规范化后的 JSON 配对 */
export interface PendingOrigin {
  bom: boolean;
  crlf: boolean;
  lead: string;
  slices: OriginSlice[];
}

/** 配好对的原文信息：每个打开时的顶层节点的 JSON 字符串（null 表示永远算改过） */
export interface Origin extends PendingOrigin {
  keys: (string | null)[];
  owner: number[];
}

const DEF_LINE = /^ {0,3}\[(\^?(?:[^\\[\]]|\\.)+)\]:/;
const LABEL = /\[(\^?[^[\]\n]{1,999})\]/g;
const LIST_TYPES = new Set(["bulletList", "taskList", "orderedList"]);

/** 链接 / 脚注标签的比较形式：忽略大小写和多余空白 */
export function normLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 一行是定义行（[标签]: 或 [^标签]:）时返回规范化的标签 */
export function defLabelOf(line: string): string | null {
  const m = DEF_LINE.exec(line);
  return m ? normLabel(m[1]) : null;
}

const CONTAINER_PREFIX = /^(?:[ \t]*>)*[ \t]*/;
const FENCE_START = /^(`{3,}|~{3,})/;

/** 一段原文里所有定义行（含引用块、列表项里嵌套的），line 是去掉容器前缀后的那一行。只认块开头的定义：定义不能打断段落 */
export function defLinesIn(text: string): { label: string; line: string }[] {
  const out: { label: string; line: string }[] = [];
  let fence = "";
  let blockStart = true;
  for (const raw of text.split("\n")) {
    const body = raw.replace(CONTAINER_PREFIX, "");
    const f = FENCE_START.exec(body);
    if (f || fence) {
      if (f && !fence) fence = f[1][0];
      else if (f && body.startsWith(fence.repeat(3))) fence = "";
      blockStart = false;
      continue;
    }
    const m: RegExpExecArray | null = blockStart ? /^\[(\^?(?:[^\\[\]]|\\.)+)\]:/.exec(body) : null;
    if (m) out.push({ label: normLabel(m[1]), line: body });
    blockStart = m !== null || body.trim() === "";
  }
  return out;
}

/** 一段原文里出现过的全部 [标签]（规范化、去重） */
export function scanLabels(text: string): string[] {
  if (!text.includes("[")) return [];
  return [...new Set([...text.matchAll(LABEL)].map((m) => normLabel(m[1])))];
}

/** 有原文却读成了空段落：保存时空段落会被滤掉，原文就丢了，所以这一片改成原样保留的块 */
function keepable(nodes: PMNode[], text: string): PMNode[] {
  return nodes.some(isEmptyParagraph) ? [rawNode(text)] : nodes;
}

/** 解析结果 → 编辑器 JSON + 待配对的原文信息 */
export function openDoc(parsed: ParsedSource): { json: DocJSON; pending: PendingOrigin } {
  const groups = parsed.slices.map((s) => (s.kind === "raw" ? [rawNode(s.text)] : keepable(s.blocks.map(blockToNode), s.text)));
  let next = 0;
  const slices = parsed.slices.map((s, i) => {
    const first = next;
    next += groups[i].length;
    return { text: s.text, sep: s.sep, first, count: groups[i].length, labels: s.labels, raw: s.kind === "raw" };
  });
  return { json: { type: "doc", content: groups.flat() }, pending: { bom: parsed.bom, crlf: parsed.crlf, lead: parsed.lead, slices } };
}

/** 用会话建好后 getJSON() 的结果和原文切片配对；顶层块数对不上时全部当作改过（不会错位） */
export function bindOrigin(pending: PendingOrigin, sessionJson: DocJSON): Origin {
  const total = pending.slices.reduce((n, s) => n + s.count, 0);
  // 会话可能在末尾补一个空段落（setContent 换内容后实测会补）；写出时空段落本来就不算，这里也不算
  const nodes = (sessionJson.content ?? []).filter((n) => !isEmptyParagraph(n));
  const keys = nodes.length === total ? nodes.map((n) => JSON.stringify(n)) : new Array<string | null>(total).fill(null);
  const owner = pending.slices.flatMap((s, i) => new Array<number>(s.count).fill(i));
  return { ...pending, keys, owner };
}

const DP_LIMIT = 1_000_000;

function lcsRange(A: number[], B: number[], a0: number, a1: number, b0: number, b1: number, match: number[]): void {
  const n = a1 - a0;
  const m = b1 - b0;
  const w = m + 1;
  const L = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * w + j] = A[a0 + i] === B[b0 + j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[a0 + i] === B[b0 + j]) match[b0 + j++] = a0 + i++;
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) i++;
    else j++;
  }
}

/** 两边都只出现一次的键，按位置取最长递增子序列，作为对齐的锚点（patience diff） */
function anchors(A: number[], B: number[], a0: number, a1: number, b0: number, b1: number): [number, number][] {
  const countA = new Map<number, number>();
  const posA = new Map<number, number>();
  for (let i = a0; i < a1; i++) {
    countA.set(A[i], (countA.get(A[i]) ?? 0) + 1);
    posA.set(A[i], i);
  }
  const countB = new Map<number, number>();
  for (let j = b0; j < b1; j++) countB.set(B[j], (countB.get(B[j]) ?? 0) + 1);
  const pairs: [number, number][] = [];
  for (let j = b0; j < b1; j++) if (countA.get(B[j]) === 1 && countB.get(B[j]) === 1) pairs.push([posA.get(B[j])!, j]);
  const tails: number[] = [];
  const prev = new Array<number>(pairs.length).fill(-1);
  pairs.forEach(([ai], k) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][0] < ai) lo = mid + 1;
      else hi = mid;
    }
    prev[k] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = k;
  });
  const out: [number, number][] = [];
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) out.unshift(pairs[k]);
  return out;
}

function matchRange(A: number[], B: number[], range: [number, number, number, number], match: number[]): void {
  let [a0, a1, b0, b1] = range;
  while (a0 < a1 && b0 < b1 && A[a0] === B[b0]) match[b0++] = a0++;
  while (a1 > a0 && b1 > b0 && A[a1 - 1] === B[b1 - 1]) match[--b1] = --a1;
  if (a0 === a1 || b0 === b1) return;
  if ((a1 - a0) * (b1 - b0) <= DP_LIMIT) return lcsRange(A, B, a0, a1, b0, b1, match);
  let pa = a0;
  let pb = b0;
  for (const [ai, bj] of anchors(A, B, a0, a1, b0, b1)) {
    matchRange(A, B, [pa, ai, pb, bj], match);
    match[bj] = ai;
    pa = ai + 1;
    pb = bj + 1;
  }
  if (pa > a0 || pb > b0) matchRange(A, B, [pa, a1, pb, b1], match);
}

/** 按顺序对齐（最长公共子序列），不按内容查表：同样 JSON 的块各认各的原文。返回每个新节点对上的旧节点下标，-1 是没对上 */
function align(oldKeys: (string | null)[], newKeys: string[]): number[] {
  const ids = new Map<string, number>();
  const intern = (k: string): number => {
    if (!ids.has(k)) ids.set(k, ids.size);
    return ids.get(k)!;
  };
  const A = oldKeys.map((k, i) => (k === null ? -1 - i : intern(k)));
  const B = newKeys.map(intern);
  const match = new Array<number>(B.length).fill(-1);
  matchRange(A, B, [0, A.length, 0, B.length], match);
  return match;
}

function defSources(texts: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const text of texts) {
    for (const { label } of defLinesIn(text)) if (!map.has(label)) map.set(label, text);
  }
  return map;
}

/** 定义行变了（删、改、加）：原文里用到受影响标签的块一律重写，重写后链接地址已在 JSON 里，不会悬空 */
function dropChangedDefs(match: number[], nodes: PMNode[], origin: Origin): number[] {
  const before = defSources(origin.slices.filter((s) => s.raw).map((s) => s.text));
  const after = defSources(nodes.filter((n) => n.type === "rawBlock").map((n) => String(n.attrs?.src ?? "")));
  const changed = new Set([...before.keys(), ...after.keys()].filter((l) => before.get(l) !== after.get(l)));
  if (changed.size === 0) return match;
  return match.map((o) => (o >= 0 && origin.slices[origin.owner[o]].labels.some((l) => changed.has(l)) ? -1 : o));
}

/** 一个切片含多个块时，这几个块必须全部对上且仍然相邻，否则都重写 */
function keepWholeSlices(match: number[], origin: Origin): number[] {
  const at = new Map<number, number>();
  match.forEach((o, j) => {
    if (o >= 0) at.set(o, j);
  });
  const broken = new Set<number>();
  origin.slices.forEach((s, i) => {
    if (s.count < 2) return;
    const j0 = at.get(s.first);
    const whole = j0 !== undefined && Array.from({ length: s.count }, (_, k) => at.get(s.first + k) === j0 + k).every(Boolean);
    if (!whole) broken.add(i);
  });
  return broken.size ? match.map((o) => (o >= 0 && broken.has(origin.owner[o]) ? -1 : o)) : match;
}

type Unit = { slice: number; from: number; to: number } | { node: number };

function firstLine(text: string): string {
  return text.split("\n", 1)[0];
}

/** 依赖上下文的块：邻居不是原来那个时不能照写原文 */
function needsRewrite(nodes: PMNode[], j: number, slice: number, origin: Origin, prev: Unit | undefined): boolean {
  const node = nodes[j];
  const text = origin.slices[slice].text;
  const prevIsOriginal = prev !== undefined && "slice" in prev && prev.slice === slice - 1;
  if (node.type === "frontmatter" && j !== 0) return true;
  if (j === 0 && slice !== 0 && /^ {0,3}-{3,}[ \t]*$/.test(firstLine(text))) return true;
  const prevNode = j > 0 ? nodes[j - 1] : null;
  if (!prevNode || !LIST_TYPES.has(prevNode.type) || prevIsOriginal) return false;
  const sameFamily = LIST_TYPES.has(node.type) && (node.type === "orderedList") === (prevNode.type === "orderedList");
  return sameFamily || /^[ \t]/.test(text);
}

function planUnits(nodes: PMNode[], match: number[], origin: Origin): Unit[] {
  const units: Unit[] = [];
  let j = 0;
  while (j < nodes.length) {
    const o = match[j];
    const slice = o >= 0 ? origin.owner[o] : -1;
    const s = slice >= 0 ? origin.slices[slice] : null;
    if (!s || o !== s.first || needsRewrite(nodes, j, slice, origin, units[units.length - 1])) {
      const count = s && o === s.first ? s.count : 1;
      for (let k = 0; k < count; k++) units.push({ node: j + k });
      j += count;
      continue;
    }
    units.push({ slice, from: j, to: j + s.count });
    j += s.count;
  }
  return units;
}

/** 两块在原文里本来就相邻且都照写原文：沿用原来的空行；否则一个空行 */
function separator(prev: Unit, next: Unit, origin: Origin): string {
  return "slice" in prev && "slice" in next && next.slice === prev.slice + 1 ? origin.slices[prev.slice].sep : "\n\n";
}

function assemble(units: Unit[], nodes: PMNode[], origin: Origin): string {
  let out = "";
  let prev: Unit | null = null;
  let prevText = "";
  for (const u of units) {
    const lastNode = prev ? nodes["slice" in prev ? prev.to - 1 : prev.node] : null;
    const text = "slice" in u ? origin.slices[u.slice].text : blockToMarkdown(nodes[u.node], { ...listOptions(nodes[u.node], lastNode, prevText), first: prev === null });
    if (text === "") continue;
    out += prev === null ? text : separator(prev, u, origin) + text;
    prev = u;
    prevText = text;
  }
  if (prev === null) return origin.lead;
  const tail = origin.slices.length ? origin.slices[origin.slices.length - 1].sep : "\n";
  return origin.lead + out + tail;
}

/** 编辑器 JSON → Markdown：没改过的顶层块写原文切片（逐字节），改过的按固定写法重写 */
export function saveDoc(json: DocJSON, origin: Origin): string {
  const nodes = (json.content ?? []).filter((n) => !isEmptyParagraph(n));
  const aligned = align(origin.keys, nodes.map((n) => JSON.stringify(n)));
  const match = keepWholeSlices(dropChangedDefs(aligned, nodes, origin), origin);
  const body = assemble(planUnits(nodes, match, origin), nodes, origin);
  return joinEndings(body, origin);
}
