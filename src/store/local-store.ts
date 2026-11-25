/**
 * 浏览器本地的文档库：每篇两个键，正文 `md.<id>` 和说明 `md.meta.<id>`（名字、标题、改动时间、版本）。
 * 版本放在说明里，每写一次加一；写之前先比对，对不上就不写（另一个标签页改过）。
 * 写完在 Storage 里记一笔哪篇变了（`CHANGED_KEY`），别的标签页不用等回到窗口就能跟上（`watch`）。
 */
import { Storage } from "nsh";
import { markdownTitle } from "../doc/title";
import type { DocMeta, DocumentStore, ReadResult, StoreChange, Version, WriteResult } from "./document-store";
import { historyKey } from "./history";
import { AssetRejected, assetName, assetPathFromSrc, assetSrc, checkImage, mimeOf, sniffImage } from "./image-file";
import { isQuotaError, type Kv, LEGACY_DOC_KEY, LOCAL_TAG, localKv, scopedKey, STASH_PREFIX } from "./kv";

const META_PREFIX = "md.meta.";
/** 图片按文档存（`md.asset.<文档 id>/<哈希>.<扩展名>`）：同一篇里同一张图只存一份，删文档时连它的图片一起删，不用查别的文档引没引用。 */
const ASSET_PREFIX = "md.asset.";
/** 每张图最近一次存进来（含再贴一次同一张）的时间，键和图片一一对应（`md.assetAt.<文档 id>/<文件名>`）。 */
const ASSET_AT_PREFIX = "md.assetAt.";
/** 存进来不到这么久的图片不清：可能是另一个标签页刚贴进来、还没保存的。10 分钟远长于停手后 800ms 的自动保存。 */
const SWEEP_MIN_AGE = 10 * 60 * 1000;
/** 一张图最大 10 MiB：和网关一样，换到网关文库时同一张图也存得进去；IndexedDB 的额度按磁盘算，单个值不卡这个数。 */
const MAX_LOCAL_ASSET_BYTES = 10 * 1024 * 1024;

/**
 * 换成多篇之前就有的那一篇的 id。正文键是 `md.<id>`，所以它的正文就是原来的 `md.document`，不用搬：
 * 迁移不占额外空间，跑几次都一样。它在有说明之前（第一次保存之前）由 `list` 按正文补出来。
 */
export const FIRST_DOC_ID = "document";

/**
 * 「哪篇刚写过」的记号键，值是 `<id> <时间>`，每次写完、新建、改名、删除后记一笔。别的标签页靠 `Storage.on("change")` 收到它：
 * 正文在 IndexedDB 里，那边的写入别的标签页收不到通知；存在 Storage 里时也不看说明键，因为说明先写、正文后写，先到的说明会让对方读到旧正文配新版本。
 */
export const CHANGED_KEY = "md.local.changed";

/** 别的标签页改了 Storage 里的 `key` → 哪篇变了：记号键给出那一篇，整个清空（`key` 是 null）算全部，别的键不管。 */
export function changedDocs(key: string | null | undefined, value: string | null | undefined): StoreChange | null {
  if (key === null || key === undefined) return { ids: [], all: true };
  if (key !== CHANGED_KEY || !value) return null;
  return { ids: [value.split(" ")[0]], all: false };
}

const announce = (id: string) => {
  Storage.setItem(CHANGED_KEY, `${id} ${Date.now()}`).catch((e: unknown) => console.warn("change not announced to other tabs", e));
};

export const bodyKey = (id: string) => `md.${id}`;
export const metaKey = (id: string) => `${META_PREFIX}${id}`;
const assetKey = (docId: string, name: string) => `${ASSET_PREFIX}${docId}/${name}`;
const assetAtKey = (assetKeyName: string) => `${ASSET_AT_PREFIX}${assetKeyName.slice(ASSET_PREFIX.length)}`;
/** 这篇的应急键：浏览器本地的文档只会有浏览器本地的应急键（规则见 unsaved.ts 的 `stashKey`）。 */
const stashKeyOf = (id: string) => scopedKey(STASH_PREFIX, LOCAL_TAG, id);

/** 说明里存的东西（id 在键里）。 */
type StoredMeta = Omit<DocMeta, "id">;

function parseMeta(id: string, raw: unknown): DocMeta | null {
  if (typeof raw !== "string") return null;
  try {
    const m = JSON.parse(raw) as Partial<StoredMeta>;
    if (typeof m.name !== "string" || typeof m.version !== "number") return null;
    return { id, name: m.name, title: typeof m.title === "string" ? m.title : "", updatedAt: typeof m.updatedAt === "number" ? m.updatedAt : 0, version: m.version, size: typeof m.size === "number" ? m.size : 0 };
  } catch (e) {
    console.warn("document meta unreadable", id, e);
    return null;
  }
}

const encodeMeta = ({ id: _id, ...rest }: DocMeta) => JSON.stringify(rest);

function describe(id: string, name: string, text: string, version: number): DocMeta {
  return { id, name, title: markdownTitle(text), updatedAt: Date.now(), version, size: text.length };
}

/** 新文档的 id：`d` 开头，和 `md.` 后面别的键（settings、meta.…）不会撞。 */
const newId = () => `d${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

function cleanName(name: string): string {
  const clean = name.trim();
  if (clean === "") throw new Error("名字不能是空的");
  return clean;
}

/** 还没有说明的第一篇：按正文补一份，版本 0、改动时间不知道。 */
async function legacyMeta(kv: Kv): Promise<DocMeta | null> {
  const body = await kv.get(LEGACY_DOC_KEY);
  if (typeof body !== "string") return null;
  return { id: FIRST_DOC_ID, name: markdownTitle(body) || "未命名", title: markdownTitle(body), updatedAt: 0, version: 0, size: body.length };
}

async function list(kv: Kv): Promise<DocMeta[]> {
  const keys = await kv.keys(META_PREFIX);
  const metas = await Promise.all(keys.map(async (key) => parseMeta(key.slice(META_PREFIX.length), await kv.get(key))));
  const found = metas.filter((m): m is DocMeta => m !== null);
  if (found.some((m) => m.id === FIRST_DOC_ID)) return found;
  const first = await legacyMeta(kv);
  return first ? [...found, first] : found;
}

async function read(kv: Kv, id: string): Promise<ReadResult | null> {
  return kv.update([bodyKey(id), metaKey(id)], ([body, raw]) => {
    const meta = parseMeta(id, raw);
    if (typeof body !== "string" && !meta) return { result: null };
    return { result: { text: typeof body === "string" ? body : "", version: meta?.version ?? 0 } };
  });
}

/** 这一篇没了（别处删掉了）也照写：编辑器里的字不能因此丢掉。 */
async function write(kv: Kv, id: string, text: string, baseVersion: Version): Promise<WriteResult> {
  return kv.update<WriteResult>([metaKey(id)], ([raw]) => {
    const meta = parseMeta(id, raw);
    const version = typeof meta?.version === "number" ? meta.version : 0;
    if (version !== baseVersion) return { result: { ok: false, version } };
    const next = describe(id, meta?.name ?? (markdownTitle(text) || "未命名"), text, version + 1);
    // 说明排在前面：Storage 里是一个个写的，大的正文写不进去时 kv.ts 把已经写了的说明改回去，说明小，改回去基本不会再满
    return { puts: { [metaKey(id)]: encodeMeta(next), [bodyKey(id)]: text }, result: { ok: true, meta: next } };
  });
}

async function rename(kv: Kv, id: string, name: string): Promise<DocMeta> {
  const clean = cleanName(name);
  return kv.update([metaKey(id), bodyKey(id)], ([raw, body]) => {
    const meta = parseMeta(id, raw) ?? (typeof body === "string" ? describe(id, clean, body, 0) : null);
    // 别处删掉了：不能为了改名凭空建出一篇空的
    if (!meta) throw new Error("这篇文档已经不在了（可能在别的标签页里删掉了）");
    const next = { ...meta, name: clean };
    return { puts: { [metaKey(id)]: encodeMeta(next) }, result: next };
  });
}

async function remove(kv: Kv, id: string) {
  const assets = [...(await kv.keys(`${ASSET_PREFIX}${id}/`)), ...(await kv.keys(`${ASSET_AT_PREFIX}${id}/`))];
  await kv.update([], () => ({ deletes: [bodyKey(id), metaKey(id), historyKey(id, LOCAL_TAG), ...assets], result: undefined }));
}

/** 版本历史里每一版的原文；读不出来（格式不对）是 null。没有历史是空的。 */
function historyTexts(raw: unknown): string[] | null {
  if (raw === null) return [];
  if (typeof raw !== "string") return null;
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list) || !list.every((s) => typeof s?.text === "string")) return null;
    return list.map((s: { text: string }) => s.text);
  } catch (e) {
    console.warn("history unreadable, images kept", e);
    return null;
  }
}

/** 这张图存进来超过 `SWEEP_MIN_AGE` 了：没记时间的（早先存的）一律算不知道，不清。 */
async function settled(kv: Kv, key: string, now: number): Promise<boolean> {
  const at = await kv.get(assetAtKey(key));
  return typeof at === "number" && now - at >= SWEEP_MIN_AGE;
}

/**
 * 清掉这篇不再用的图片（撤销了粘贴、删掉了图片留下的）：正文和每个历史版本里都没提到它的文件名、而且存进来超过 10 分钟的才删。
 * 历史读不出来、有还没并回去的应急键（里面的正文可能用着新图）时不清。
 */
async function sweepAssets(kv: Kv, id: string, text: string, now = Date.now()) {
  const keys = await kv.keys(`${ASSET_PREFIX}${id}/`);
  if (keys.length === 0 || (await Storage.getItem(stashKeyOf(id))) !== null) return;
  const history = historyTexts(await kv.get(historyKey(id, LOCAL_TAG)));
  if (history === null) return;
  const used = [text, ...history];
  const candidates = keys.filter((k) => !used.some((t) => t.includes(k.slice(k.lastIndexOf("/") + 1))));
  const unused: string[] = [];
  for (const k of candidates) if (await settled(kv, k, now)) unused.push(k, assetAtKey(k));
  if (unused.length > 0) await kv.update([], () => ({ deletes: unused, result: undefined }));
}

/** 存一张图（已经有了就只记下这次存的时间）；存储满了换成给人看的话。 */
async function putAssetBytes(kv: Kv, key: string, bytes: Uint8Array) {
  const at = { [assetAtKey(key)]: Date.now() };
  try {
    await kv.update([key], ([there]) => ({ puts: there === null ? { ...at, [key]: bytes } : at, result: undefined }));
  } catch (e) {
    if (!isQuotaError(e)) throw e;
    console.warn("image not stored: storage full", e);
    throw new AssetRejected("浏览器存储满了，图片没存进去。删掉用不着的文档（它的图片会一起删掉），或者连上本机网关把文档存成文件");
  }
}

/**
 * IndexedDB 一度打不开时文档落在了 Storage 里（更早的单篇 `md.document` 也在那）：这次用上 IndexedDB 了，就把 Storage 里的每一篇（正文、说明、历史）搬过去。
 * 一篇一个事务，写成了才删 Storage 里那份，中途出错两边都不丢，重跑也一样；IndexedDB 里已经有这篇的不搬也不删，不拿旧的盖新的。
 */
async function moveStorageDocs(kv: Kv) {
  const keys = new Set(await Storage.keys());
  const ids = new Set([...keys].filter((k) => k.startsWith(META_PREFIX)).map((k) => k.slice(META_PREFIX.length)));
  if (keys.has(LEGACY_DOC_KEY)) ids.add(FIRST_DOC_ID);
  for (const id of ids) {
    const docKeys = [bodyKey(id), metaKey(id), historyKey(id, LOCAL_TAG)].filter((k) => keys.has(k));
    const entries = (await Promise.all(docKeys.map(async (k) => [k, await Storage.getItem(k)] as const))).filter(([, v]) => v !== null);
    const moved = await kv.update([bodyKey(id), metaKey(id)], (there) =>
      there.some((v) => v !== null) ? { result: false } : { puts: Object.fromEntries(entries), result: true },
    );
    if (moved) for (const [k] of entries) await Storage.removeItem(k);
  }
}

export function createLocalStore(open: () => Promise<Kv> = localKv): DocumentStore {
  let moving: Promise<void> | null = null;
  const ready = async (): Promise<Kv> => {
    const kv = await open();
    if (!kv.binary) return kv;
    moving ??= moveStorageDocs(kv).catch((e: unknown) => {
      // 这次没搬成：那几篇这次看不见，下次读写再搬
      moving = null;
      console.error("documents in Storage not moved into IndexedDB", e);
    });
    await moving;
    return kv;
  };
  return {
    list: async () => list(await ready()),
    read: async (id) => read(await ready(), id),
    sweepAssets: async (id, text) => sweepAssets(await ready(), id, text),
    async write(id, text, baseVersion) {
      const result = await write(await ready(), id, text, baseVersion);
      if (result.ok) announce(id);
      return result;
    },
    async create(name, text) {
      const kv = await ready();
      const meta = describe(newId(), cleanName(name), text, 1);
      await kv.update([], () => ({ puts: { [bodyKey(meta.id)]: text, [metaKey(meta.id)]: encodeMeta(meta) }, result: undefined }));
      announce(meta.id);
      return meta;
    },
    async rename(id, name) {
      const meta = await rename(await ready(), id, name);
      announce(id);
      return meta;
    },
    async remove(id) {
      await remove(await ready(), id);
      announce(id);
    },
    async putAsset(docId, bytes) {
      const name = assetName(bytes, checkImage(bytes, MAX_LOCAL_ASSET_BYTES));
      const kv = await ready();
      if (!kv.binary) throw new Error("这里的本机存储只能存文字，存不了图片（浏览器的 IndexedDB 没能用上）");
      await putAssetBytes(kv, assetKey(docId, name), bytes);
      return assetSrc(name);
    },
    async getAsset(docId, src) {
      const path = assetPathFromSrc(docId, src);
      if (!path || path.split("/").length !== 2) return null;
      const value = await (await ready()).get(assetKey(docId, path.slice(path.indexOf("/") + 1)));
      if (!(value instanceof Uint8Array)) return null;
      const ext = sniffImage(value);
      return ext ? { mime: mimeOf(ext), bytes: value } : null;
    },
    watch(onChange) {
      return Storage.on("change", ({ key, value }) => {
        const change = changedDocs(key, value);
        if (change) onChange(change);
      });
    },
  };
}
