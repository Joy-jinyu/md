/**
 * 同步要记在本机的东西：GitHub 的登录（token 和账号名）、网页登录途中的 state、每篇文档的同步记录、上次同步的时间。
 * token 只由这里保存、只由 src/sync/ 读取（.claude/rules/security.md）；不打日志，退出登录时删掉。
 * token 放在 Storage（网页是这个站点的 localStorage，macOS 是应用自己的存储）：nsh 0.6.0 没有钥匙串接口（2026-11-25 查 .nsh/types/）。
 * 同步记录里有基线全文，可能很大，所以和版本历史一样放在 kv.ts 选的键值库（浏览器里是 IndexedDB）；其余是小键，放 Storage。
 * 文档删了，它的同步记录不留在 id 上（文件类后端的 id 是路径，同名的新文档会落到同一个 id 上、接着推进旧 Gist），挪成按 Gist id 记的墓碑（`buryRecord`）。
 */
import { Storage } from "nsh";
import { LOCAL_TAG, localKv, scopedKey } from "./kv";

const AUTH_KEY = "md.sync.auth";
const OAUTH_STATE_KEY = "md.sync.oauthState";
const LAST_SYNC_KEY = "md.sync.lastAt";
const RECORD_PREFIX = "md.sync.doc.";
const GONE_PREFIX = "md.sync.gone.";

let scope = LOCAL_TAG;

/** 这次用的后端（backend.ts 定下存储时调）：同一个 id 在不同文库里不是同一篇，同步记录和版本历史一样按后端分开放。 */
export function setSyncScope(tag: string) {
  scope = tag;
}

/** 一篇的同步记录键。`tag` 默认是这次用的后端；浏览器本地的是 `md.sync.doc.<id>`，别的是 `md.sync.doc.[<后端>]<id>`。 */
export const syncRecordKey = (id: string, tag = scope) => scopedKey(RECORD_PREFIX, tag, id);

/** 本机删掉的那篇留下的同步记录（墓碑），按它连着的 Gist 的 id 记；分后端的方式和 `syncRecordKey` 一样。 */
const goneKey = (gistId: string, tag = scope) => scopedKey(GONE_PREFIX, tag, gistId);

export interface SavedAuth {
  token: string;
  login: string;
}

/** 这篇和哪个 Gist 连着：Gist 的 id、里面的文件名、上次同步时两边的文本（基线）、远端版本号、是哪个账号的。 */
export interface GistLink {
  gistId: string;
  fileName: string;
  base: string;
  version: string;
  login: string;
  syncedAt: number;
}

/** 一篇的同步记录：连着的 Gist（没同步过就没有），和用户选了「不同步这篇」。 */
export interface SyncRecord {
  link?: GistLink;
  excluded?: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch (e) {
    console.warn("sync data unreadable", e);
    return null;
  }
}

export async function readAuth(): Promise<SavedAuth | null> {
  const v = parseJson(await Storage.getItem(AUTH_KEY));
  return isObject(v) && typeof v.token === "string" && v.token !== "" && typeof v.login === "string" ? { token: v.token, login: v.login } : null;
}

export const saveAuth = (auth: SavedAuth): Promise<void> => Storage.setItem(AUTH_KEY, JSON.stringify(auth));

export const clearAuth = (): Promise<void> => Storage.removeItem(AUTH_KEY);

/** 网页登录途中记下的：state、发起的时间、PKCE 的 code_verifier、授权页用的回调地址（换 token 时要原样再给一次）。 */
export interface OAuthState {
  state: string;
  at: number;
  verifier: string;
  redirectUri: string;
}

/** 网页登录：跳去 GitHub 之前记下 state、时间和 code_verifier，回来时取出来比对。 */
export const saveOAuthState = (saved: OAuthState): Promise<void> => Storage.setItem(OAUTH_STATE_KEY, JSON.stringify(saved));

/** 读出记下的 state（不删）：对上了再用 `clearOAuthState` 作废，对不上的回调不消耗它。 */
export async function readOAuthState(): Promise<OAuthState | null> {
  const v = parseJson(await Storage.getItem(OAUTH_STATE_KEY));
  if (!isObject(v)) return null;
  const { state, at, verifier, redirectUri } = v;
  return typeof state === "string" && typeof at === "number" && typeof verifier === "string" && typeof redirectUri === "string" ? { state, at, verifier, redirectUri } : null;
}

/** 一个 state 只能用一次：用过（或过期）就删掉。 */
export const clearOAuthState = (): Promise<void> => Storage.removeItem(OAUTH_STATE_KEY);

export async function readLastSync(): Promise<number | null> {
  const v = Number(await Storage.getItem(LAST_SYNC_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export const saveLastSync = (at: number): Promise<void> => Storage.setItem(LAST_SYNC_KEY, String(at));

function parseLink(v: unknown): GistLink | undefined {
  if (!isObject(v)) return undefined;
  const { gistId, fileName, base, version, login, syncedAt } = v;
  if (typeof gistId !== "string" || typeof fileName !== "string" || typeof base !== "string" || typeof version !== "string") return undefined;
  return { gistId, fileName, base, version, login: typeof login === "string" ? login : "", syncedAt: typeof syncedAt === "number" ? syncedAt : 0 };
}

function parseRecord(raw: unknown): SyncRecord | null {
  const v = parseJson(raw);
  if (!isObject(v)) return null;
  const link = parseLink(v.link);
  const excluded = v.excluded === true;
  return link || excluded ? { ...(link ? { link } : {}), ...(excluded ? { excluded } : {}) } : null;
}

/** `base` 前缀下、这次用的后端的全部记录，按键里前缀后面那段。 */
async function recordsUnder(base: string): Promise<Map<string, SyncRecord>> {
  const kv = await localKv();
  const prefix = scopedKey(base, scope, "");
  // 浏览器本地的键不带标签，以「[」开头的是别的后端的
  const keys = (await kv.keys(prefix)).filter((key) => scope !== LOCAL_TAG || !key.startsWith(`${base}[`));
  const entries = await Promise.all(keys.map(async (key) => [key.slice(prefix.length), parseRecord(await kv.get(key))] as const));
  return new Map(entries.filter((e): e is readonly [string, SyncRecord] => e[1] !== null));
}

/** 这次用的后端里全部文档的同步记录，按文档 id。别的后端的不在里面。 */
export const syncRecords = (): Promise<Map<string, SyncRecord>> => recordsUnder(RECORD_PREFIX);

/** 这次用的后端里本机删掉的那些篇的同步记录（墓碑），按 Gist id。 */
export const goneRecords = (): Promise<Map<string, SyncRecord>> => recordsUnder(GONE_PREFIX);

/**
 * 这台设备上（不管哪个后端）连着的、`login` 这个账号的 Gist，本机删了还没处理的也算：
 * 网关这次没连上时，文库里的那些也不算「这台设备上没有」。
 */
export async function linkedGistIds(login: string): Promise<Set<string>> {
  const kv = await localKv();
  const keys = [...(await kv.keys(RECORD_PREFIX)), ...(await kv.keys(GONE_PREFIX))];
  const records = await Promise.all(keys.map(async (key) => parseRecord(await kv.get(key))));
  return new Set(records.flatMap((r) => (r?.link && r.link.login === login ? [r.link.gistId] : [])));
}

export async function syncRecordOf(id: string): Promise<SyncRecord | null> {
  return parseRecord(await (await localKv()).get(syncRecordKey(id)));
}

async function putRecord(key: string, record: SyncRecord | null) {
  const kv = await localKv();
  const empty = !record || (!record.link && !record.excluded);
  await kv.update([], () => (empty ? { deletes: [key], result: undefined } : { puts: { [key]: JSON.stringify(record) }, result: undefined }));
}

/** 写一篇的同步记录；`null` 或者什么都没有的记录就删掉。写不进去（存储满了）抛错。 */
export const putSyncRecord = (id: string, record: SyncRecord | null) => putRecord(syncRecordKey(id), record);

export async function goneRecordOf(gistId: string): Promise<SyncRecord | null> {
  return parseRecord(await (await localKv()).get(goneKey(gistId)));
}

/** 写一条墓碑；`null` 是删掉（拉回本机了、GitHub 上也没了）。 */
export const putGoneRecord = (gistId: string, record: SyncRecord | null) => putRecord(goneKey(gistId), record);

/** 墓碑：这条记录连着 Gist 时写成按 Gist id 记的墓碑；没连着（只记了「不同步」）的不留。 */
const buried = (raw: unknown): Record<string, string> => {
  const link = parseRecord(raw)?.link;
  return link && typeof raw === "string" ? { [goneKey(link.gistId)]: raw } : {};
};

/**
 * 这篇删了，或者它的 id 要给一篇新的用：同步记录从 id 上拿走，连着 Gist 的挪成墓碑（同步时列成「本机删了，GitHub 上还在」让用户选）。
 * `gistId`：只在记录还连着这个 Gist 时才挪（同步途中这个 id 上换成了新记录就不动）。
 */
export async function buryRecord(id: string, gistId?: string) {
  const key = syncRecordKey(id);
  const kv = await localKv();
  await kv.update([key], ([raw]) => {
    const record = parseRecord(raw);
    if (!record || (gistId !== undefined && record.link?.gistId !== gistId)) return { result: undefined };
    return { puts: buried(raw), deletes: [key], result: undefined };
  });
}

/**
 * 一篇换了 id（文件改名、从浏览器本地搬进文库，`fromTag` 是它原来所在的后端）：同步记录跟过去。旧 id 下没有记录时什么都不动。
 * 新 id 下已有的记录是别的（已经不在这个名字上的）文档留下的：挪成墓碑，不能留着把这篇推进别人的 Gist。
 * `keep`：原来那篇还在（复制）。连着的 Gist 只能跟一篇，所以跟着新的那篇走，原来那篇记成「不同步」，免得以后悄悄另建一个 Gist；没连着 Gist 时什么都不动。
 */
export async function moveSyncRecord(from: string, to: string, fromTag = scope, keep = false) {
  const [fromKey, toKey] = [syncRecordKey(from, fromTag), syncRecordKey(to)];
  if (fromKey === toKey) return;
  const kv = await localKv();
  await kv.update([fromKey, toKey], ([old, there]) => {
    if (typeof old !== "string" || (keep && !parseRecord(old)?.link)) return { result: undefined };
    const stale = parseRecord(there)?.link?.gistId === parseRecord(old)?.link?.gistId ? {} : buried(there);
    const left = keep ? { [fromKey]: JSON.stringify({ excluded: true }) } : {};
    return { puts: { ...stale, [toKey]: old, ...left }, deletes: keep ? [] : [fromKey], result: undefined };
  });
}
