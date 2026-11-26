/** 页面顶上那一条回执（打开了哪个、存到哪了、删掉了哪篇）：做完一件事说一句，出错的话不自己消失。规则见 DESIGN.md「回执」。 */
import { signal } from "nsh";
import type { Phrase } from "../../i18n";

/** 回执留多久自己消失（毫秒）。 */
const RECEIPT_MS = 8000;

export type Tone = "info" | "warn";

export const receipt = signal<{ text: Phrase; tone: Tone } | null>(null);

let timer: ReturnType<typeof setTimeout> | undefined;

/** `text` 传 `() => t(…)`，回执还在时切换语言会跟着变。 */
export function say(text: Phrase, tone: Tone) {
  if (timer) clearTimeout(timer);
  receipt.set({ text, tone });
  if (tone === "info") timer = setTimeout(() => receipt.set(null), RECEIPT_MS);
}

/** 用户点了「×」。 */
export function dismissReceipt() {
  if (timer) clearTimeout(timer);
  receipt.set(null);
}

/** 换到另一篇文档时调：出错的回执说的是换之前的事，留着会让人以为是新这篇的。提示类的到时间自己消失，不动。 */
export function clearWarning() {
  if (receipt()?.tone === "warn") receipt.set(null);
}
