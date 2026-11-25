/**
 * 浏览器的 IndexedDB，当一个「键 → 值」的库用（值是字符串，图片是二进制）。只在 store 里用。
 * 用它放文档正文：nsh 的 Storage 在浏览器里落在 localStorage，上限 5MB；IndexedDB 的额度按磁盘算，大得多。
 * 只有浏览器里有（应用代码在 web host 上直接跑在页面里）；macOS 等别的 host 没有，由调用方退回 Storage。
 */

const DB_NAME = "md";
const STORE_NAME = "kv";
const DB_VERSION = 1;

/** 用到的那一小部分 IndexedDB 接口：项目的 TypeScript 配置里没有浏览器的类型库。 */
interface Request<T> {
  result: T;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}
interface OpenRequest extends Request<Database> {
  onupgradeneeded: (() => void) | null;
  onblocked: (() => void) | null;
}
interface Database {
  close(): void;
  onversionchange: (() => void) | null;
  onclose: (() => void) | null;
  createObjectStore(name: string): unknown;
  transaction(name: string, mode: "readonly" | "readwrite"): Transaction;
}
interface ObjectStore {
  get(key: string): Request<unknown>;
  getAllKeys(): Request<unknown[]>;
  put(value: unknown, key: string): Request<unknown>;
  delete(key: string): Request<unknown>;
}
interface Transaction {
  objectStore(name: string): ObjectStore;
  error: unknown;
  abort(): void;
  oncomplete: (() => void) | null;
  onabort: (() => void) | null;
}

const factory = (globalThis as { indexedDB?: { open(name: string, version: number): OpenRequest } }).indexedDB;

/** 这个环境里有没有 IndexedDB。有也不一定能用（无痕窗口、被禁用），打不开时读写会抛错。 */
export const hasIndexedDb = factory !== undefined;

let opening: Promise<Database> | null = null;

function open(): Promise<Database> {
  opening ??= new Promise<Database>((resolve, reject) => {
    if (!factory) return reject(new Error("IndexedDB is not available"));
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => {
      const db = request.result;
      // 别的标签页（或开发者工具）要升级、删除这个库时让开：不关的话对方会一直卡住，之后谁也打不开。下次读写再重新打开
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      // 浏览器自己把连接关了（清了站点数据、磁盘出错）：下次读写重新打开，不然之后每次都失败
      db.onclose = () => {
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
  // 这次没打开的话下次重试，不把失败的结果一直留着
  opening.catch(() => {
    opening = null;
  });
  return opening;
}

/** 读一个键；没有是 null。 */
export async function idbGet(key: string): Promise<unknown> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/** 全部键。 */
export async function idbKeys(): Promise<string[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAllKeys();
    request.onsuccess = () => resolve(request.result.filter((k): k is string => typeof k === "string"));
    request.onerror = () => reject(request.error);
  });
}

/** 一次读写要改的：写哪些键、删哪些键，以及交回调用方的结果。 */
export interface Change<T> {
  puts?: Record<string, unknown>;
  deletes?: string[];
  result: T;
}

/**
 * 在一个事务里先读 `reads`，再按 `decide` 的结果写和删：别的标签页插不进中间，「版本对得上才写」靠它。
 * 等事务真正提交才算写完；写不进去（额度满了等）抛浏览器给的错误，这时一个键也没改。
 */
export async function idbUpdate<T>(reads: string[], decide: (values: unknown[]) => Change<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const values: unknown[] = new Array(reads.length).fill(null);
    let left = reads.length;
    let outcome: { result: T } | null = null;
    // 出错的原因（比如额度满了的 QuotaExceededError）先出现在出错的那个请求上，事务上的 error 那时还是空的；
    // 所以等事务真的中止了再报，原因取请求上的
    let failure: unknown = null;
    const watch = (request: Request<unknown>) => {
      request.onerror = () => {
        failure ??= request.error;
      };
    };
    const apply = () => {
      try {
        const change = decide(values);
        for (const [key, value] of Object.entries(change.puts ?? {})) watch(store.put(value, key));
        for (const key of change.deletes ?? []) watch(store.delete(key));
        outcome = { result: change.result };
      } catch (e) {
        failure = e;
        tx.abort();
      }
    };
    reads.forEach((key, i) => {
      const request = store.get(key);
      watch(request);
      request.onsuccess = () => {
        values[i] = request.result ?? null;
        left -= 1;
        if (left === 0) apply();
      };
    });
    if (reads.length === 0) apply();
    tx.oncomplete = () => (outcome ? resolve(outcome.result) : reject(new Error("IndexedDB transaction finished without a result")));
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("IndexedDB write aborted"));
  });
}
