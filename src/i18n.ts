import { signal } from "nsh";
import { loadLocale, saveLocale, type Locale } from "./store/settings";

const selected = signal<Locale>("en");
let initial: Promise<void> | undefined;

export const locale = () => selected();
export const t = (zh: string, en: string) => (locale() === "zh-CN" ? zh : en);

/** 存起来稍后显示的文字：传函数的在显示时才翻译，切换语言会跟着变；传字符串的原样显示（错误原因、文件名这类已经定下来的）。 */
export type Phrase = string | (() => string);
export const phrase = (p: Phrase) => (typeof p === "function" ? p() : p);

export function initializeLocale(): Promise<void> {
  initial ??= loadLocale().then((saved) => selected.set(saved));
  return initial;
}

export async function changeLocale(value: Locale): Promise<string | null> {
  selected.set(value);
  return saveLocale(value);
}
