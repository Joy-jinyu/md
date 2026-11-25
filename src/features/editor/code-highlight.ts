/** 代码块语法高亮：块里照常打字，分词结果用行内装饰上色（只改显示，不改文档）。 */
import type { RichDecoration, RichEditorSession } from "nsh/base";
import { eachNode, type Node, textOf } from "./outline";
import { CODE_KEY } from "./rich-session";
import { selectionRange } from "./selection";
import { type Token, type TokenKind, tokenize } from "./syntax";

/** 每种片段的字色：theme.json 里的语法角色，明暗两套。 */
const TOKEN_CLASS: Record<TokenKind, string> = {
  keyword: "text-syntax-keyword",
  string: "text-syntax-string",
  comment: "text-syntax-comment italic",
  number: "text-syntax-number",
  type: "text-syntax-type",
  attr: "text-syntax-attr",
};

/** 停手多久后重新上色（毫秒）：连着打字时每键都重交装饰更慢（下面的实测里每键多 15ms 左右）。 */
const PAINT_DELAY = 150;

/**
 * 一个代码块最多上多少段色，超过就整块不上色。块里每打一个字宿主都要把整块连同装饰重画一遍：
 * 2026-11-25 本机 web host（headless Chrome）实测，200 行 JS、600 段色的块每键约 45ms，不上色约 7ms；按比例 1000 段约 75ms。
 */
const MAX_TOKENS_PER_BLOCK = 1000;

/**
 * 全文最多上多少段色：装饰是整份一起交的，块里一改就全部重交；装饰多了，正文里打字也跟着慢。
 * 超过时先给光标所在的块、再按离光标由近到远给，放不下的块不上色。
 * 2026-11-25 本机 web host（headless Chrome）实测，40 个 60 行的 js 块（148KB，约 1.9 万段色）：
 * 不设总量时在段落里每键约 520–550ms 长任务；上限 1500 时四轮里有一轮每键 50–75ms、三轮没有超过 50ms 的长任务；上限 1000 时段落和代码块里打字都没有。
 */
const MAX_TOKENS_TOTAL = 1000;

/** 代码超过这么多字符就不分词、不上色：分词是逐字扫描，太长的块一次扫完会占住 JS 太久。 */
const MAX_CODE_CHARS = 20_000;

/** 分词结果按「语言 + 代码」缓存，没改的块不重算；超过这么多条就整个清掉重来。 */
const CACHE_LIMIT = 200;

interface CodeBlock {
  pos: number;
  key: string;
  language: string | null;
  code: string;
}

function codeBlockOf(node: Node, pos: number): CodeBlock {
  const language = typeof node.attrs?.language === "string" ? node.attrs.language : null;
  const code = textOf(node);
  return { pos, key: `${language ?? ""}\n${code}`, language, code };
}

function codeBlocks(doc: Node): CodeBlock[] {
  const out: CodeBlock[] = [];
  eachNode(doc, (node, pos) => {
    if (node.type !== "codeBlock") return;
    out.push(codeBlockOf(node, pos));
    return false;
  });
  return out;
}

/** 离光标多远：光标在块里是 0。 */
function distance(block: CodeBlock, caret: number): number {
  const end = block.pos + block.code.length + 2;
  return caret < block.pos ? block.pos - caret : caret > end ? caret - end : 0;
}

export function createCodeHighlight(session: RichEditorSession) {
  const cache = new Map<string, Token[]>();
  /** 上次交出去的那些块（按文档顺序的 key）：装饰会跟着文档改动自己挪位置，块没变就不用重交。 */
  let painted = "";
  let colored = new Set<string>();
  /** 上次有块因为总量上限没上色：这时光标走进一个没上色的块要重排。 */
  let leftOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tokensOf = (block: CodeBlock): Token[] => {
    let tokens = cache.get(block.key);
    if (!tokens) {
      if (cache.size >= CACHE_LIMIT) cache.clear();
      const all = block.code.length > MAX_CODE_CHARS ? [] : tokenize(block.code, block.language);
      tokens = all.length > MAX_TOKENS_PER_BLOCK ? [] : all;
      cache.set(block.key, tokens);
    }
    return tokens;
  };

  /** 在总量上限内挑要上色的块：离光标近的先挑，放不下的跳过；结果按文档顺序。 */
  const pick = (blocks: CodeBlock[]): CodeBlock[] => {
    const caret = selectionRange(session).head;
    const byDistance = blocks.filter((b) => tokensOf(b).length > 0).sort((a, b) => distance(a, caret) - distance(b, caret));
    const chosen = new Set<CodeBlock>();
    let total = 0;
    leftOut = false;
    for (const b of byDistance) {
      const n = tokensOf(b).length;
      if (total + n > MAX_TOKENS_TOTAL) leftOut = true;
      else {
        chosen.add(b);
        total += n;
      }
    }
    return blocks.filter((b) => chosen.has(b));
  };

  /** 重新挑块、重算装饰；挑出来的块和上次的一样（内容、语言、顺序都没变）就不再交（交装饰本身也会让编辑器报一次修订）。 */
  const paint = () => {
    timer = undefined;
    const chosen = pick(codeBlocks(session.getJSON() as Node));
    const signature = chosen.map((b) => b.key).join("\u0000");
    if (signature === painted) return;
    painted = signature;
    colored = new Set(chosen.map((b) => b.key));
    const decorations: RichDecoration[] = chosen.flatMap((b) =>
      tokensOf(b).map((t) => ({ from: b.pos + 1 + t.from, to: b.pos + 1 + t.to, kind: "inline" as const, attrs: { class: TOKEN_CLASS[t.kind] } })),
    );
    session.setDecorations(CODE_KEY, decorations);
  };

  /** 文档改了之后调：停手 PAINT_DELAY 后才重算，连着打字时旧装饰由编辑器自己跟着挪。 */
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(paint, PAINT_DELAY);
  };
  /** 整篇换过（从源码视图切回来）：编辑器里的旧装饰不一定还在，不管上次交过什么都重交。 */
  const repaint = () => {
    painted = "";
    schedule();
  };
  /** 选区动了：有块因为总量上限没上色、光标又走进了这样的块时，重排一次。 */
  const caretMoved = () => {
    if (!leftOut || timer !== undefined) return;
    const found = session.findParentNode("codeBlock") as { pos: number; node: Node } | null;
    if (!found) return;
    const block = codeBlockOf(found.node, found.pos);
    if (!colored.has(block.key) && tokensOf(block).length > 0) schedule();
  };
  const dispose = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return { schedule, repaint, caretMoved, dispose };
}
