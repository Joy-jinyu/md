/** 选中文字的词数：和顶栏整篇的词数（编辑器自己数的）同一个口径。 */
import { t } from "../../i18n";

/** 中日韩文字每个字算一个词（nsh 0.6.0 实测 `session.words()` 就是这么数的），其余按连着的字母、数字算。 */
const WORD = /[぀-ヿ㐀-鿿가-힯豈-﫿]|[\p{L}\p{N}]+/gu;
const CJK_RUN = /([぀-ヿ㐀-鿿가-힯豈-﫿])/g;

export function countWords(text: string): number {
  // 先把中日韩文字两边隔开，免得和挨着的字母连成一个词
  return text.replace(CJK_RUN, " $1 ").match(WORD)?.length ?? 0;
}

/** 字符数：不算换行，一个表情算一个。 */
export function countChars(text: string): number {
  return [...text.replace(/\n/g, "")].length;
}


export interface DocumentCounts {
  chars: number;
  words?: number;
}

export function formatCounts({ chars, words }: DocumentCounts, selected = false): string {
  const englishChars = `${chars} ${chars === 1 ? "character" : "characters"}`;
  if (words === undefined) return t(`${chars} 字符`, englishChars);
  const englishWords = `${words} ${words === 1 ? "word" : "words"}`;
  return t(`${selected ? "选中 " : ""}${words} 字词 · ${chars} 字符`, `${selected ? "Selected " : ""}${englishWords} · ${englishChars}`);
}
