/**
 * 全文搜索：在所有文档的 Markdown 原文里找一个词（不分大小写），每篇最多给几行。
 * JS 单次调用有 2000ms 预算，所以一篇一篇读，每篇之间、以及一篇里找了一阵以后都让出这一轮。
 */
import type { DocMeta } from "../../store/document-store";

export interface SearchHit {
  id: string;
  /** 命中的那一行（截到合适长度）。 */
  snippet: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** 有命中的文档数。 */
  docs: number;
  /** 命中太多，后面的没列出来。 */
  capped: boolean;
}

/** 每篇最多列几行、一共最多列几行：再多一屏也看不完，换个更准的词更快。 */
const PER_DOC = 3;
const TOTAL = 100;
/** 片段在命中处前面留几个字、一共最长多少字。 */
const BEFORE = 24;
const SNIPPET = 90;
/** 连续干多久（毫秒）就让出一次，远低于 2000ms 的预算。 */
const SLICE_MS = 30;

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function snippetAt(text: string, index: number): string {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  const line = text.slice(lineStart, end < 0 ? text.length : end);
  const from = Math.max(0, index - lineStart - BEFORE);
  const piece = line.slice(from, from + SNIPPET).trim();
  return `${from > 0 ? "…" : ""}${piece}${from + SNIPPET < line.length ? "…" : ""}`;
}

/** 在一篇里找，最多 `max` 行（同一行只算一次）。 */
export function findInText(text: string, query: string, max = PER_DOC): string[] {
  const needle = query.toLowerCase();
  if (needle === "") return [];
  const hay = text.toLowerCase();
  const out: string[] = [];
  for (let at = hay.indexOf(needle); at >= 0 && out.length < max; ) {
    out.push(snippetAt(text, at));
    const lineEnd = hay.indexOf("\n", at);
    if (lineEnd < 0) break;
    at = hay.indexOf(needle, lineEnd + 1);
  }
  return out;
}

/**
 * 逐篇搜索。`read` 取一篇的原文（开着的那篇传最新的、没存的也算）；`stale` 返回 true 时说明有了新的搜索，这次中途放弃（结果是 null）。
 */
export async function searchDocuments(
  query: string,
  docs: DocMeta[],
  read: (id: string) => Promise<string | null>,
  stale: () => boolean,
): Promise<SearchResult | null> {
  const hits: SearchHit[] = [];
  let matched = 0;
  let started = Date.now();
  for (const doc of docs) {
    if (Date.now() - started > SLICE_MS) {
      await tick();
      started = Date.now();
    }
    if (stale()) return null;
    const text = await read(doc.id);
    if (stale()) return null;
    const lines = text === null ? [] : findInText(text, query);
    if (lines.length === 0) continue;
    matched += 1;
    for (const snippet of lines) {
      if (hits.length === TOTAL) return { hits, docs: matched, capped: true };
      hits.push({ id: doc.id, snippet });
    }
  }
  return { hits, docs: matched, capped: false };
}
