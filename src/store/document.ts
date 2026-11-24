/**
 * 本机存的这一篇文档（Markdown 原文）：读取、停手后写入、立即写入。
 * 正文在浏览器里放 IndexedDB（额度大），别处和 IndexedDB 用不了时放 nsh 的 Storage（上限 5MB）。
 */
import { signal, Storage } from "nsh";
import { hasIndexedDb, idbGet, idbSet } from "./idb";

/** 文档正文的存储键。 */
export const DOC_KEY = "md.document";
/** 停止编辑后多久写一次（毫秒），实施计划 4.5 定的值。 */
const SAVE_DELAY = 800;

/** 写不进去的原因：`quota` 是存储满了（ERR_NSH_QUOTA_EXCEEDED），其余放在 `detail` 里。 */
export interface SaveError {
  quota: boolean;
  detail: string;
}

export type SaveState = { kind: "idle" } | { kind: "pending" } | { kind: "saved" } | { kind: "error"; error: SaveError };

export type SaveResult = { ok: true } | { ok: false; error: SaveError };

const state = signal<SaveState>({ kind: "idle" });
/** 取最新 Markdown 的函数；有它说明还有改动没写。 */
let produce: (() => string) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
/** 存储里现在的正文，相同就不再写。 */
let stored = "";
/** 整篇正在（或已经）被换成另一个文件，编辑页还没重新载入：这期间旧编辑器报来的改动一律不收，不然会把刚打开的文件盖回去。 */
let replacing = false;

export const saveState = () => state();

/** 正文是不是放在 IndexedDB 里。读的时候定下来，之后的写入跟着它，免得读一处、写另一处。 */
let inIndexedDb = false;
/** 记一笔「正文已经放进 IndexedDB 了」的键，放在 Storage 里。 */
const IN_IDB_KEY = "md.document.inIndexedDb";

/**
 * 从 IndexedDB 读正文。里面还没有、而 Storage 里有（换存法之前存的）时搬过来：
 * 先写进 IndexedDB，写成了才删 Storage 里的那份，中途出错两边都不丢。
 */
async function loadFromIndexedDb(): Promise<string | null> {
  const text = await idbGet(DOC_KEY);
  if (text !== null) return text;
  const legacy = await Storage.getItem(DOC_KEY);
  if (legacy === null) return null;
  await idbSet(DOC_KEY, legacy);
  await Storage.removeItem(DOC_KEY);
  return legacy;
}

/**
 * 读出存着的正文；从没存过时是 `null`。
 * IndexedDB 打不开时：以前从没用过它（无痕窗口、被禁用）就退回 Storage，这次打开期间都用 Storage；
 * 以前用过（正文在它里面）就抛错——那时装作没有文档、让人接着在 Storage 里写，下次 IndexedDB 好了会读回旧的那份，新写的看不见。
 */
export async function loadDocument(): Promise<string | null> {
  replacing = false;
  let text: string | null;
  if (hasIndexedDb) {
    try {
      text = await loadFromIndexedDb();
      inIndexedDb = true;
      if ((await Storage.getItem(IN_IDB_KEY)) === null) await Storage.setItem(IN_IDB_KEY, "1");
    } catch (e) {
      if ((await Storage.getItem(IN_IDB_KEY)) !== null) throw new Error(`浏览器的 IndexedDB 这次打不开，文档还在里面，没有丢（${e instanceof Error ? e.message : String(e)}）。关掉别的标签页或重新打开浏览器再试。`);
      console.warn("IndexedDB unavailable, using Storage for the document", e);
      inIndexedDb = false;
      text = await Storage.getItem(DOC_KEY);
    }
  } else {
    text = await Storage.getItem(DOC_KEY);
  }
  stored = text ?? "";
  return text;
}

const writeDocument = (text: string) => (inIndexedDb ? idbSet(DOC_KEY, text) : Storage.setItem(DOC_KEY, text));

/**
 * 文档改了：记下怎么取最新的 Markdown，停手 800ms 后再取、再写。
 * 取 Markdown 可能较重，所以传函数，等写的时候才调。
 */
export function markChanged(next: () => string) {
  if (replacing) return;
  produce = next;
  state.set({ kind: "pending" });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), SAVE_DELAY);
}

/** 这篇文档现在的 Markdown：有还没写进存储的改动就现取。 */
export function latestDocument(): string {
  return produce ? produce() : stored;
}

/**
 * 把整篇换成 `text` 并立即写入（打开另一个文件时用）。原来那篇没写的改动不要了。
 * 写不进去时什么都不变：原来没写的改动还留着等下次写，调用方不要重新载入。
 * 写成了以后调用方必须重新载入编辑页（`loadDocument`）：在那之前这里不再收改动。
 */
export async function replaceDocument(text: string): Promise<SaveResult> {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const pending = produce;
  const before = state();
  produce = null;
  replacing = true;
  try {
    await writeDocument(text);
  } catch (e) {
    // 没换成：原来没写的改动放回去照常等着写，保存状态也回到之前（这次失败由调用方另外说明）
    replacing = false;
    produce = pending;
    state.set(before);
    if (pending) timer = setTimeout(() => void flush(), SAVE_DELAY);
    return { ok: false, error: toSaveError(e) };
  }
  // 成功后 replacing 一直开着，直到编辑页重新载入（loadDocument）才关
  stored = text;
  state.set({ kind: "saved" });
  return { ok: true };
}

/** 立即写入还没写的改动（失焦、切到后台、退出时调）。写不进去时结果里带原因，状态也变成 error；改动留着，不定时重试，等下一次编辑或下一次失焦 / 退出时再写。 */
export async function flush(): Promise<SaveResult> {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const next = produce;
  if (!next) return { ok: true };
  produce = null;
  let text: string;
  try {
    text = next();
  } catch (e) {
    return fail(next, e);
  }
  if (text === stored) return settle();
  try {
    await writeDocument(text);
  } catch (e) {
    return fail(next, e);
  }
  stored = text;
  return settle();
}

function settle(): SaveResult {
  if (!produce) state.set({ kind: "saved" });
  return { ok: true };
}

function fail(next: () => string, e: unknown): SaveResult {
  produce = produce ?? next;
  const error = toSaveError(e);
  state.set({ kind: "error", error });
  return { ok: false, error };
}

function toSaveError(e: unknown): SaveError {
  const { code, name } = typeof e === "object" && e !== null ? (e as { code?: unknown; name?: unknown }) : {};
  // Storage 满了报 ERR_NSH_QUOTA_EXCEEDED，IndexedDB 满了报名叫 QuotaExceededError 的错
  return { quota: code === "ERR_NSH_QUOTA_EXCEEDED" || name === "QuotaExceededError", detail: e instanceof Error ? e.message : String(e) };
}
