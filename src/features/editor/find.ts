/** 查找替换：查找条用的引擎接口，和所见即所得这一边的实现（源码那一边在 SourcePane 里，用编辑器自带的查找）。 */
import { signal } from "nsh";
import { chain, deleteRange, insertText, type RichCommand, type RichDecoration, type RichEditorSession, scrollIntoView, setTextSelection } from "nsh/base";
import type { Node } from "./outline";
import { FIND_KEY } from "./rich-session";
import { selectionRange } from "./selection";

export interface FindQuery {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface FindResult {
  count: number;
  /** 当前停在第几个上（从 0 数），没停在任何一个上是 null。 */
  current: number | null;
  /** 命中太多，只算了前面一部分。 */
  capped: boolean;
  /** 正则写错时的原因。 */
  error: string | null;
}

export interface FindEngine {
  /** 换查找内容；null 是停止查找、清掉高亮。 */
  search(query: FindQuery | null): void;
  result(): FindResult;
  next(): void;
  previous(): void;
  /** 替换当前这一个，再跳到下一个。 */
  replace(text: string): void;
  /** 全部替换，返回换了几处。 */
  replaceAll(text: string): Promise<number>;
}

export const NO_RESULT: FindResult = { count: 0, current: null, capped: false, error: null };

export interface Match {
  from: number;
  to: number;
  text: string;
  /** 命中所在文本块的文字和命中在里面的起点：正则替换要带着前后文再算一遍（前瞻、后顾要看到命中以外的字）。 */
  block: string;
  index: number;
}

/**
 * 最多找多少处。所见即所得的文档不超过 4000 行（见 EditorScreen 的上限），
 * 2000 个行内装饰在 JS 这边 3ms 交出去（nsh 0.6.0 实测）；更多的用「2000+」表示。
 */
export const MAX_MATCHES = 2000;

/** 文本块里不是文字的行内节点（换行、行内公式…）在查找用的字符串里占一个字符，位置才对得上；命中里带它的不算。 */
const LEAF = "￼";
const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 按查找条的选项拼出正则；正则写错时抛 SyntaxError。 */
export function buildPattern(q: FindQuery, global = true): RegExp {
  const body = q.regex ? q.query : escapeRegex(q.query);
  const source = q.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])` : body;
  return new RegExp(source, `${global ? "g" : ""}u${q.caseSensitive ? "" : "i"}`);
}

function blockText(node: Node): string {
  return (node.content ?? []).map((child) => (child.type === "text" ? (child.text ?? "") : LEAF)).join("");
}

/** 走一遍文档，对每个文本块调 `visit(文字, 文字第一个字符的位置)`；返回这个节点占多少位置。 */
function walk(node: Node, pos: number, visit: (text: string, start: number) => void): number {
  if (node.type === "text") return node.text?.length ?? 0;
  if (TEXTBLOCKS.has(node.type)) {
    const text = blockText(node);
    visit(text, pos + 1);
    return text.length + 2;
  }
  if (!node.content) return 1;
  let size = 2;
  for (const child of node.content) size += walk(child, pos + size - 1, visit);
  return size;
}

/** 在文档里找出所有命中（不跨块），最多 `limit` 处。 */
export function findMatches(doc: Node, q: FindQuery, limit = MAX_MATCHES): { matches: Match[]; capped: boolean; error: string | null } {
  if (q.query === "") return { matches: [], capped: false, error: null };
  let pattern: RegExp;
  try {
    pattern = buildPattern(q);
  } catch (e) {
    return { matches: [], capped: false, error: e instanceof Error ? e.message : String(e) };
  }
  const matches: Match[] = [];
  let capped = false;
  let pos = 0;
  for (const block of doc.content ?? []) {
    pos += walk(block, pos, (text, start) => {
      if (capped) return;
      pattern.lastIndex = 0;
      for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
        if (m[0] === "") pattern.lastIndex++;
        else if (!m[0].includes(LEAF)) {
          if (matches.length === limit) {
            capped = true;
            return;
          }
          matches.push({ from: start + m.index, to: start + m.index + m[0].length, text: m[0], block: text, index: m.index });
        }
      }
    });
  }
  return { matches, capped, error: null };
}

/** 一处命中换成什么：正则方式下 `$1`、`$<name>` 指分组，普通方式照字面。 */
export function replacementFor(m: Match, q: FindQuery, replacement: string): string {
  if (!q.regex) return replacement;
  const at = buildPattern(q, false);
  const sticky = new RegExp(at.source, `${at.flags}y`);
  sticky.lastIndex = m.index;
  const out = m.block.replace(sticky, replacement);
  return out.slice(m.index, out.length - (m.block.length - m.index - m.text.length));
}

const swap = (m: Match, text: string): RichCommand[] =>
  text === "" ? [deleteRange({ from: m.from, to: m.to })] : [setTextSelection(m.from, m.to), insertText(text)];

/** 所见即所得这一边的查找：命中处用装饰高亮，跳转就是把选区放到命中上。 */
export function createRichFind(session: RichEditorSession) {
  let query: FindQuery | null = null;
  let matches: Match[] = [];
  const result = signal<FindResult>(NO_RESULT);

  const paint = (current: number | null, capped: boolean, error: string | null) => {
    const decorations: RichDecoration[] = matches.map((m, i) => ({
      from: m.from,
      to: m.to,
      kind: "inline",
      attrs: { class: i === current ? "bg-find-current" : "bg-find" },
    }));
    session.setDecorations(FIND_KEY, decorations);
    result.set({ count: matches.length, current, capped, error });
  };
  /** 重新找一遍；选区正好在某个命中上就算停在它上面。 */
  const refresh = () => {
    if (!query) return;
    const found = findMatches(session.getJSON() as Node, query);
    matches = found.matches;
    const { from, to } = selectionRange(session);
    const at = matches.findIndex((m) => m.from === from && m.to === to);
    paint(at < 0 ? null : at, found.capped, found.error);
  };
  const go = (index: number) => {
    const m = matches[index];
    session.run(chain([setTextSelection(m.from, m.to), scrollIntoView()]));
    paint(index, result().capped, null);
  };
  const step = (direction: 1 | -1) => {
    if (matches.length === 0) return;
    const current = result().current;
    if (current !== null) return go((current + direction + matches.length) % matches.length);
    const { head } = selectionRange(session);
    const ahead = matches.findIndex((m) => m.from >= head);
    if (direction === 1) return go(ahead < 0 ? 0 : ahead);
    go(((ahead < 0 ? matches.length : ahead) - 1 + matches.length) % matches.length);
  };

  const engine: FindEngine = {
    search(next) {
      query = next;
      if (next) return refresh();
      matches = [];
      paint(null, false, null);
    },
    result: () => result(),
    next: () => step(1),
    previous: () => step(-1),
    replace(text) {
      const current = result().current;
      if (!query || current === null) return step(1);
      const m = matches[current];
      const put = replacementFor(m, query, text);
      session.run(chain(swap(m, put)));
      refresh();
      const ahead = matches.findIndex((x) => x.from >= m.from + put.length);
      if (matches.length > 0) go(ahead < 0 ? 0 : ahead);
    },
    replaceAll(text) {
      const q = query;
      if (!q || matches.length === 0) return Promise.resolve(0);
      // 高亮最多 2000 处，替换要全部：不设上限重找一遍
      const all = findMatches(session.getJSON() as Node, q, Infinity).matches;
      // 从后往前换，前面的位置不受影响；合成一次改动，撤销一步回来
      session.run(chain(all.toReversed().flatMap((m) => swap(m, replacementFor(m, q, text)))));
      refresh();
      return Promise.resolve(all.length);
    },
  };
  return { engine, refresh, isActive: () => query !== null };
}
