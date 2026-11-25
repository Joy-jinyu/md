/** 同步冲突时的按块对比（实施计划 4.8）：块 = 空行分开的一段原文。纯函数，不引 nsh。 */

/** 一块和另一边比的结果：两边都有（`same`），或者只在这一边（`only`）。 */
export interface DiffBlock {
  text: string;
  only: boolean;
}

/** `rough`：有一段太长、又找不到两边各只出现一次的块来分段，那一段没有逐块比较，整段标成了不同（界面上要说明）。 */
export interface BlockDiff {
  local: DiffBlock[];
  remote: DiffBlock[];
  rough: boolean;
}

/** 一段里两边块数相乘超过这个数就不直接求最长公共子序列（表太大），先按两边各只出现一次的块分段：JS 单次调用有 2000ms 预算。 */
const MAX_CELLS = 2_000_000;

/** 按空行切块；行尾统一成 \n，块首尾的空行不算。 */
export function splitBlocks(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((b) => b.replace(/^\n+|\n+$/g, ""))
    .filter((b) => b.trim() !== "");
}

/** 一段：x 的 [a0, a1) 对 y 的 [b0, b1)。 */
type Range = [number, number, number, number];

/** 两段的最长公共子序列，两边都有的下标记进 sameA / sameB。块已经换成了编号，比的是整数。 */
function lcs(x: Int32Array, y: Int32Array, [a0, a1, b0, b1]: Range, sameA: Uint8Array, sameB: Uint8Array) {
  const n = a1 - a0;
  const m = b1 - b0;
  const table = new Int32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[at(i, j)] = x[a0 + i] === y[b0 + j] ? table[at(i + 1, j + 1)] + 1 : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[a0 + i] === y[b0 + j]) {
      sameA[a0 + i++] = 1;
      sameB[b0 + j++] = 1;
    } else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) i++;
    else j++;
  }
}

/** 两边都只出现一次的块，按两边顺序都递增的最长那一串（patience diff 的锚点）：[x 里的下标，y 里的下标]。 */
function anchors(x: Int32Array, y: Int32Array, [a0, a1, b0, b1]: Range): [number, number][] {
  const seen = new Map<number, { inA: number; inB: number; i: number; j: number }>();
  for (let i = a0; i < a1; i++) {
    const s = seen.get(x[i]);
    if (s) s.inA++;
    else seen.set(x[i], { inA: 1, inB: 0, i, j: -1 });
  }
  for (let j = b0; j < b1; j++) {
    const s = seen.get(y[j]);
    if (s && ++s.inB === 1) s.j = j;
  }
  const pairs = [...seen.values()].filter((s) => s.inA === 1 && s.inB === 1).sort((p, q) => p.i - q.i);
  // 按 y 的下标求最长递增子序列：tails[k] 是长 k+1 的串里结尾最小的那一对，prev 记前一对
  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  pairs.forEach((p, k) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]].j < p.j) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  });
  const chain: [number, number][] = [];
  for (let k = tails.length > 0 ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) chain.push([pairs[k].i, pairs[k].j]);
  return chain.reverse();
}

/** 两段有没有一样的块（有的话整段标成不同就不准了）。 */
function shareAny(x: Int32Array, y: Int32Array, [a0, a1, b0, b1]: Range): boolean {
  const inA = new Set(x.subarray(a0, a1));
  return y.subarray(b0, b1).some((v) => inA.has(v));
}

/** 逐段比：去掉相同的头尾；小的段直接求最长公共子序列，大的段按锚点再切。返回有没有一段没能逐块比较。 */
function match(x: Int32Array, y: Int32Array, sameA: Uint8Array, sameB: Uint8Array): boolean {
  let rough = false;
  const work: Range[] = [[0, x.length, 0, y.length]];
  for (let range = work.pop(); range; range = work.pop()) {
    let [a0, a1, b0, b1] = range;
    while (a0 < a1 && b0 < b1 && x[a0] === y[b0]) {
      sameA[a0++] = 1;
      sameB[b0++] = 1;
    }
    while (a0 < a1 && b0 < b1 && x[a1 - 1] === y[b1 - 1]) {
      sameA[--a1] = 1;
      sameB[--b1] = 1;
    }
    if (a0 === a1 || b0 === b1) continue;
    const rest: Range = [a0, a1, b0, b1];
    if ((a1 - a0) * (b1 - b0) <= MAX_CELLS) {
      lcs(x, y, rest, sameA, sameB);
      continue;
    }
    const chain = anchors(x, y, rest);
    if (chain.length === 0) {
      rough = rough || shareAny(x, y, rest);
      continue;
    }
    let [pa, pb] = [a0, b0];
    for (const [i, j] of chain) {
      sameA[i] = 1;
      sameB[j] = 1;
      work.push([pa, i, pb, j]);
      [pa, pb] = [i + 1, j + 1];
    }
    work.push([pa, a1, pb, b1]);
  }
  return rough;
}

/** 本机和远端按块对比：两边各自的块，标出只在这一边的。块先换成编号（一样的块同一个号），比较只比整数。 */
export function diffBlocks(localText: string, remoteText: string): BlockDiff {
  const a = splitBlocks(localText);
  const b = splitBlocks(remoteText);
  const ids = new Map<string, number>();
  const idOf = (text: string) => {
    const known = ids.get(text);
    if (known !== undefined) return known;
    ids.set(text, ids.size);
    return ids.size - 1;
  };
  const x = Int32Array.from(a, idOf);
  const y = Int32Array.from(b, idOf);
  const sameA = new Uint8Array(a.length);
  const sameB = new Uint8Array(b.length);
  const rough = match(x, y, sameA, sameB);
  return { local: a.map((text, i) => ({ text, only: sameA[i] === 0 })), remote: b.map((text, i) => ({ text, only: sameB[i] === 0 })), rough };
}
