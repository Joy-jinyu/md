/**
 * 文档面板的状态：搜索词和结果、排序、哪一行展开了操作、要改名 / 删除的是哪篇。
 * 放在模块顶层：切文档时编辑页整个重建，面板也跟着重建，这些不该跟着清掉（点完一个搜索结果还要接着点下一个）。
 */
import { locale, t } from "../../i18n";
import { handleError } from "../../doc/message";
import { signal } from "nsh";
import { latestDocument } from "../../store/document";
import type { DocMeta } from "../../store/document-store";
import { allDocs, currentDocId, displayName, readDocument } from "../../store/library";
import { type SearchResult, searchDocuments } from "./search";

export type SortBy = "time" | "name";
export type SearchState = { kind: "idle" } | { kind: "running" } | { kind: "done"; query: string; result: SearchResult };

export const panel = {
  query: signal(""),
  search: signal<SearchState>({ kind: "idle" }),
  sort: signal<SortBy>("time"),
  /** 展开了「重命名 / 版本历史 / 删除」的那一行。 */
  expanded: signal<string | null>(null),
  renaming: signal<DocMeta | null>(null),
  deleting: signal<DocMeta | null>(null),
};

/** 停止输入多久后开始搜（毫秒）：每敲一个字都把所有文档读一遍太浪费。 */
const SEARCH_DELAY = 250;

let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** 开着的那篇用编辑器里最新的（还没存的也算），别的从存储里读；读不出的当没有。 */
async function textOf(id: string): Promise<string | null> {
  if (id === currentDocId()) return latestDocument();
  try {
    return (await readDocument(id))?.text ?? null;
  } catch (e) {
    handleError(e, { context: `search skipped a document: ${id}`, severity: "warn" });
    return null;
  }
}

async function run(query: string, mine: number) {
  const result = await searchDocuments(query, allDocs(), textOf, () => mine !== generation);
  if (result && mine === generation) panel.search.set({ kind: "done", query, result });
}

export function setQuery(value: string) {
  panel.query.set(value);
  if (timer) clearTimeout(timer);
  generation += 1;
  const query = value.trim();
  if (query === "") return panel.search.set({ kind: "idle" });
  panel.search.set({ kind: "running" });
  const mine = generation;
  timer = setTimeout(() => void run(query, mine), SEARCH_DELAY);
}

export function sorted(list: DocMeta[], by: SortBy): DocMeta[] {
  return by === "time" ? [...list].sort((a, b) => b.updatedAt - a.updatedAt) : [...list].sort((a, b) => displayName(a).localeCompare(displayName(b), locale()));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 同步状态和文档时间共用的月日格式。 */
export function monthDay(d: Date): string {
  return t(`${d.getMonth() + 1}月${d.getDate()}日`, `${MONTHS[d.getMonth()]} ${d.getDate()}`);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 几点几分（`14:03`）：文档列表和顶栏的同步时间都用它。 */
export const hourMinute = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 改动时间分档（DESIGN.md「文档列表」）：今天、昨天写几点几分，今年更早的写月日加时分，往年写年月日；不知道（换存法前的那篇还没存过）就直说。 */
export function timeLabel(at: number, now = Date.now()): string {
  if (at <= 0) return t("改动时间未知", "Last edit unknown");
  const d = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const hm = hourMinute(d);
  if (d.toDateString() === today.toDateString()) return t(`今天 ${hm}`, `Today ${hm}`);
  if (d.toDateString() === yesterday.toDateString()) return t(`昨天 ${hm}`, `Yesterday ${hm}`);
  if (d.getFullYear() === today.getFullYear()) return t(`${monthDay(d)} ${hm}`, `${monthDay(d)}, ${hm}`);
  return t(`${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`, `${monthDay(d)}, ${d.getFullYear()}`);
}
