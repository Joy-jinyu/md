/**
 * 本机的键值库：浏览器里是 IndexedDB，别处（以及 IndexedDB 从没用过且这次打不开时）是 nsh 的 Storage（上限 5MB）。
 * 文档库、版本历史都存在这里；选哪一个在第一次用的时候定下来，这次打开期间不变，免得读一处、写另一处。
 */
import { Storage } from "nsh";
import { type Change, hasIndexedDb, idbGet, idbKeys, idbUpdate } from "./idb";

export type { Change } from "./idb";

export interface Kv {
  /** 读一个键；没有是 null。 */
  get(key: string): Promise<unknown>;
  /** 以 `prefix` 开头的全部键。 */
  keys(prefix: string): Promise<string[]>;
  /** 先读 `reads` 再按 `decide` 写。IndexedDB 里读写在同一个事务里；Storage 里是先读后写，按 `puts` 的顺序一个个写，中途写不进去就把写了的改回去再抛错。 */
  update<T>(reads: string[], decide: (values: unknown[]) => Change<T>): Promise<T>;
  /** 能不能存二进制（图片）：Storage 只能存字符串。 */
  binary: boolean;
}

const storageKv: Kv = {
  get: (key) => Storage.getItem(key),
  keys: async (prefix) => (await Storage.keys()).filter((k) => k.startsWith(prefix)),
  binary: false,
  async update(reads, decide) {
    const values = await Promise.all(reads.map((key) => Storage.getItem(key)));
    const change = decide(values);
    const done: [string, string | null][] = [];
    try {
      for (const [key, value] of Object.entries(change.puts ?? {})) {
        if (typeof value !== "string") throw new Error("这里的存储只能存文字");
        const previous = await Storage.getItem(key);
        await Storage.setItem(key, value);
        done.push([key, previous]);
      }
    } catch (e) {
      await undo(done);
      throw e;
    }
    for (const key of change.deletes ?? []) await Storage.removeItem(key);
    return change.result;
  },
};

/** 一次写了几个键、中途有一个写不进去（存储满了）：把已经写了的改回原样，免得正文是新的、说明还是旧的。 */
async function undo(done: [string, string | null][]) {
  for (const [key, previous] of [...done].reverse()) {
    try {
      await (previous === null ? Storage.removeItem(key) : Storage.setItem(key, previous));
    } catch (e) {
      console.error("storage rollback failed", key, e);
    }
  }
}

const idbKv: Kv = {
  get: idbGet,
  keys: async (prefix) => (await idbKeys()).filter((k) => k.startsWith(prefix)),
  update: idbUpdate,
  binary: true,
};

/** 浏览器本地后端的标签（backend.ts 的 `backendTag`）：按后端分开放的键里只有它不带标签，和早先存的一样。 */
export const LOCAL_TAG = "local";

/** 按后端分开放的键（版本历史、同步记录、应急键、上次打开哪篇）：浏览器本地是 `<prefix><rest>`，别的是 `<prefix>[<后端>]<rest>`。 */
export const scopedKey = (prefix: string, tag: string, rest: string) => (tag === LOCAL_TAG ? `${prefix}${rest}` : `${prefix}[${tag}]${rest}`);

/** 应急键的前缀（unsaved.ts）。放这里是因为 local-store.ts 清图片前要查应急键，又不能 import unsaved.ts（unsaved → backend → local-store 成环）。 */
export const STASH_PREFIX = "md.unsaved.";

/** 换成多篇之前那一篇正文的键。它原地成为文档库的第一篇，见 local-store.ts 的 FIRST_DOC_ID。 */
export const LEGACY_DOC_KEY = "md.document";
/** 记一笔「正文已经放进 IndexedDB 了」的键，放在 Storage 里。 */
const IN_IDB_KEY = "md.document.inIndexedDb";

/**
 * IndexedDB 打不开时：以前从没用过它（无痕窗口、被禁用）就退回 Storage；
 * 以前用过（文档在它里面）就抛错——那时装作没有文档、让人接着在 Storage 里写，下次 IndexedDB 好了会读回旧的那份，新写的看不见。
 */
async function choose(): Promise<Kv> {
  if (!hasIndexedDb) return storageKv;
  try {
    // 先读一次，确认打得开；Storage 里的文档由 local-store.ts 搬过来
    await idbGet(LEGACY_DOC_KEY);
    if ((await Storage.getItem(IN_IDB_KEY)) === null) await Storage.setItem(IN_IDB_KEY, "1");
    return idbKv;
  } catch (e) {
    if ((await Storage.getItem(IN_IDB_KEY)) !== null) {
      throw new Error(`浏览器的 IndexedDB 这次打不开，文档还在里面，没有丢（${e instanceof Error ? e.message : String(e)}）。关掉别的标签页或重新打开浏览器再试。`);
    }
    console.warn("IndexedDB unavailable, using Storage for documents", e);
    return storageKv;
  }
}

let chosen: Promise<Kv> | null = null;
let resolved: Kv | null = null;

/** 这次打开用的键值库。打不开时抛带说明的错，下次调用再试。 */
export function localKv(): Promise<Kv> {
  if (!chosen) {
    chosen = choose().then((kv) => (resolved = kv));
    chosen.catch(() => {
      chosen = null;
    });
  }
  return chosen;
}

/** 这次打开的文档放没放在 IndexedDB 里（还没定下来时算没有）：没有的话文档和设置一起挤在 Storage 的 5MB 里。 */
export const docsInIndexedDb = () => resolved === idbKv;

/** 是不是存储满了：Storage 满了报 ERR_NSH_QUOTA_EXCEEDED，IndexedDB 满了报名叫 QuotaExceededError 的错。 */
export function isQuotaError(e: unknown): boolean {
  const { code, name } = typeof e === "object" && e !== null ? (e as { code?: unknown; name?: unknown }) : {};
  return code === "ERR_NSH_QUOTA_EXCEEDED" || name === "QuotaExceededError";
}
