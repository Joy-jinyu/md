/** 快速打开的模糊匹配：输入的字按顺序都出现在名字里就算中（不用连着），连着的、在开头的、整段包含的排前面。 */
import type { DocMeta } from "../../store/document-store";
import { displayName, knownTitle } from "../../store/library";

/** 不匹配是 null，分越高越靠前。不分大小写，忽略输入里的空格。 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const t = text.toLowerCase();
  if (q === "") return 0;
  let score = t.includes(q) ? 10 : 0;
  let from = 0;
  let prevEnd = -1;
  for (const ch of q) {
    const at = t.indexOf(ch, from);
    if (at < 0) return null;
    score += at === prevEnd ? 3 : 1;
    if (at === 0) score += 2;
    else if (/[\s\-_/.]/.test(t[at - 1])) score += 1;
    from = prevEnd = at + ch.length;
  }
  // 一样的分，名字短的（多余的字少）排前面
  return score - t.length / 1000;
}

/**
 * 快速打开的列表：没输入时按改动时间排（现在开着的那篇放最后，它最不用找）；
 * 输入了就按标题和文件名里分高的那个排（文件类后端的标题只有读过、存过的那几篇有，见 `knownTitle`），都不中的不列。
 */
export function rankDocs(docs: DocMeta[], query: string, currentId: string | null): DocMeta[] {
  if (query.trim() === "") {
    const recent = [...docs].sort((a, b) => b.updatedAt - a.updatedAt);
    return [...recent.filter((d) => d.id !== currentId), ...recent.filter((d) => d.id === currentId)];
  }
  return docs
    .map((doc) => {
      const scores = [displayName(doc), doc.name, knownTitle(doc)].map((text) => fuzzyScore(query, text)).filter((s): s is number => s !== null);
      return { doc, score: scores.length > 0 ? Math.max(...scores) : null };
    })
    .filter((x): x is { doc: DocMeta; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.doc);
}
