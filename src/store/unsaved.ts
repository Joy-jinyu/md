/**
 * 应急键：页面要关、切到后台时，还没写进存储的那篇正文同步记进 Storage（`stashKey`，带写入时依据的版本），下次启动时并回去。
 * 浏览器里页面卸载时 IndexedDB 的写入不提交（2026-11-25 实测：打字后 800ms 内刷新，字就丢了）；Storage 的写入在调用时就落进 localStorage 了（同日实测）。
 * 正常写成以后 document.ts 调 `dropStash` 删掉；并回去成了也删掉，没成的留着下次再试。
 */
import { signal, Storage } from "nsh";
import { backendTag, docsShareStorage, documentStore } from "./backend";
import type { Version } from "./document-store";
import { addSnapshot, noteSaved } from "./history";
import { LOCAL_TAG, scopedKey, STASH_PREFIX } from "./kv";
import { createDocument, displayName, refreshLibrary } from "./library";

/** 一篇的应急键，按后端分开（同一个路径在两个文库里不是同一篇）：浏览器本地是 `md.unsaved.<id>`，别的是 `md.unsaved.[<后端>]<id>`。 */
const stashKey = (id: string) => scopedKey(STASH_PREFIX, backendTag(), id);

/**
 * 应急键最多放多少字符：Storage 上限是键和值合计 5 MiB 字符（tests/store.test.ts 实测）；
 * 文档在 IndexedDB 时 Storage 里只有设置、上次打开哪篇这些小键，留 1 MiB 给它们。
 */
const STASH_MAX_CHARS = 4 * 1024 * 1024;

export interface Stash {
  id: string;
  /** 这段内容是在哪个版本上改的。 */
  base: Version;
  text: string;
  /** 属于哪个后端（backend.ts 的 `backendTag`）；早先写的没有这一项，算浏览器本地。 */
  backend?: string;
}

/** 这次打开期间写过应急键的文档 → 键：只有它们需要删。记下键，换了后端以后也删得对。 */
const stashed = new Map<string, string>();

/** 启动时看到的、属于别的后端（另一个网关文库、换存储之前）的应急键是哪几个后端的（`backendTag`）。 */
const elsewhere = signal<string[]>([]);
export const stashesElsewhere = () => elsewhere();

/**
 * 写应急键。写不进去的错误要等之后才报（Storage 的接口是异步的），页面关的那一刻等不到，所以「放不放得下」只能按大小估：
 * 文档在 Storage 里（IndexedDB 打不开、或者不是浏览器）时 Storage 用了多少不知道，一律算放不下。返回估计放不放得下。
 */
export function writeStash(stash: Stash): boolean {
  const key = stashKey(stash.id);
  const payload = JSON.stringify({ ...stash, backend: backendTag() });
  Storage.setItem(key, payload).catch((e: unknown) => console.warn("unsaved text not stashed", e));
  stashed.set(stash.id, key);
  return !docsShareStorage() && key.length + payload.length <= STASH_MAX_CHARS;
}

/** 这篇没有没写的改动了：删掉它的应急键。 */
export function dropStash(id: string) {
  const key = stashed.get(id);
  if (key === undefined) return;
  stashed.delete(id);
  Storage.removeItem(key).catch((e: unknown) => console.warn("stash not removed", e));
}

function parseStash(raw: string | null): Stash | null {
  if (raw === null) return null;
  try {
    const s = JSON.parse(raw) as Partial<Stash>;
    const base = typeof s.base === "number" || typeof s.base === "string" ? s.base : null;
    if (typeof s.id === "string" && base !== null && typeof s.text === "string") return { id: s.id, base, text: s.text, backend: typeof s.backend === "string" ? s.backend : LOCAL_TAG };
  } catch (e) {
    console.warn("stash unreadable", e);
  }
  return null;
}

export interface Recovered {
  text: string;
  tone: "info" | "warn";
}

/** 并回一份：版本没变就直接写进正文；别处改过就存进版本历史；那篇删了就存成一篇新文档。 */
async function mergeBack({ id, base, text }: Stash): Promise<Recovered | null> {
  const now = await documentStore.read(id);
  if (now?.text === text) return null;
  if (!now) {
    await refreshLibrary();
    const meta = await createDocument(text);
    return { text: `上次关闭前有一段修改没存上，它所在的那篇已经删除了，这段内容存成了新文档「${displayName(meta)}」。`, tone: "warn" };
  }
  if (now.version === base) {
    const result = await documentStore.write(id, text, base);
    if (result.ok) {
      await noteSaved(id, now.text, text);
      return { text: "上次关闭前还没存上的修改已经补存好了。", tone: "info" };
    }
  }
  if (!(await addSnapshot(id, text))) throw new Error("本机存储已满，存不进版本历史");
  return { text: "上次关闭前有一段修改没存上，而这篇后来在别处改过：那段修改存进了这篇的版本历史（「⋯」→「版本历史」）。", tone: "warn" };
}

/** 启动时、打开文档之前调：把上次没来得及存的改动并回去。返回要告诉用户的一句话，没有是 null。并不回去的那份留着，下次再试。 */
export async function recoverUnsaved(): Promise<Recovered | null> {
  let keys: string[];
  try {
    keys = (await Storage.keys()).filter((k) => k.startsWith(STASH_PREFIX));
  } catch (e) {
    // 读不了应急键不该挡住打开文档：留着下次再试
    console.error("stashes unreadable", e);
    return null;
  }
  let note: Recovered | null = null;
  const others = new Set<string>();
  for (const key of keys) {
    try {
      const stash = parseStash(await Storage.getItem(key));
      // 别的后端（另一个网关文库、换存储之前）的留着，等用回那个后端时再并
      if (stash && stash.backend !== backendTag()) {
        others.add(stash.backend ?? LOCAL_TAG);
        continue;
      }
      if (stash) note = (await mergeBack(stash)) ?? note;
      await Storage.removeItem(key);
    } catch (e) {
      console.error("unsaved text not recovered", key, e);
      note = { text: `上次关闭前有一段修改没存上，这次没能补回去（${e instanceof Error ? e.message : String(e)}），下次打开时再试。`, tone: "warn" };
    }
  }
  elsewhere.set([...others]);
  return note;
}
