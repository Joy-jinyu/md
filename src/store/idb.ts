/**
 * 浏览器的 IndexedDB，当一个「键 → 字符串」的库用。只在 store 里用。
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
interface Transaction {
  objectStore(name: string): { get(key: string): Request<unknown>; put(value: string, key: string): Request<unknown> };
  error: unknown;
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
export async function idbGet(key: string): Promise<string | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
    request.onerror = () => reject(request.error);
  });
}

/** 写一个键。等事务真正提交才算写完；写不进去（额度满了等）抛浏览器给的错误。 */
export async function idbSet(key: string, value: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).put(value, key);
    // 出错的原因（比如额度满了的 QuotaExceededError）先出现在这次写入的请求上，事务上的 error 那时还是空的；
    // 所以等事务真的中止了再报，原因取请求上的
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(request.error ?? tx.error ?? new Error("IndexedDB write aborted"));
  });
}
