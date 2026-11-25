/**
 * 版本历史（实施计划 4.6）：每篇一个键（`historyKey`，按后端分开），存一串快照（只有 Markdown 原文和时间），新的在前。
 * 快照记的是「被这次保存换掉的那一版」：第一次保存时、距上一份快照超过 5 分钟、或者改动大时留一份。
 * 存储写满时快照先让位：正文写不进去时由 document.ts 调 `makeRoom` 删最旧的快照再写。
 */
import { isQuotaError, type Kv, LOCAL_TAG, localKv, scopedKey } from "./kv";

export interface Snapshot {
  at: number;
  text: string;
}

const HISTORY_PREFIX = "md.history.";

let scope = LOCAL_TAG;

/** 这次用的后端（backend.ts 定下存储时调）：不同文库里同一个路径不是同一篇，版本历史分开放。 */
export function setHistoryScope(tag: string) {
  scope = tag;
}

/** 一篇的历史键。`tag` 默认是这次用的后端；浏览器本地的是 `md.history.<id>`，别的是 `md.history.[<后端>]<id>`。 */
export const historyKey = (id: string, tag = scope) => scopedKey(HISTORY_PREFIX, tag, id);

/** 两份快照之间至少隔多久（毫秒），计划 4.6 定的 5 分钟。 */
export const SNAPSHOT_INTERVAL = 5 * 60 * 1000;
/** 和上一份快照比字符数变了这么多就算改动大，不到 5 分钟也留一份。体感值：大约删掉或贴进来一屏字。 */
export const SNAPSHOT_MIN_CHANGE = 2000;
/** 每篇最多留几份，多了丢最旧的：浏览器里退回 Storage 时快照和正文共用 5MB。 */
export const MAX_SNAPSHOTS = 20;
/** 腾地方时最多删几轮：每轮删掉全部快照里最旧的一半。 */
const MAKE_ROOM_ROUNDS = 8;

function parse(raw: unknown): Snapshot[] {
  if (typeof raw !== "string") return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter((s): s is Snapshot => typeof s === "object" && s !== null && typeof s.at === "number" && typeof s.text === "string");
  } catch (e) {
    console.warn("history unreadable", e);
    return [];
  }
}

/**
 * 读出一篇的快照、按 `next` 改完写回，读和写在同一个事务里（IndexedDB；Storage 见 kv.ts），别的标签页插不进中间。
 * `next` 返回 null 是不用改。
 */
const change = (kv: Kv, key: string, next: (list: Snapshot[]) => Snapshot[] | null) =>
  kv.update([key], ([raw]) => {
    const list = next(parse(raw));
    if (list === null) return { result: undefined };
    return list.length > 0 ? { puts: { [key]: JSON.stringify(list) }, result: undefined } : { deletes: [key], result: undefined };
  });

/** 这一篇的快照，新的在前。 */
export async function snapshotsOf(id: string): Promise<Snapshot[]> {
  return parse(await (await localKv()).get(historyKey(id)));
}

/** 删掉全部文档的快照里最旧的一半（至少一份）。返回删没删掉东西：没有快照可删时是 false。 */
export async function makeRoom(): Promise<boolean> {
  const kv = await localKv();
  const keys = await kv.keys(HISTORY_PREFIX);
  const lists = await Promise.all(keys.map(async (key) => parse(await kv.get(key))));
  const times = lists.flatMap((list) => list.map((s) => s.at)).sort((a, b) => a - b);
  if (times.length === 0) return false;
  const cutoff = times[Math.max(0, Math.floor(times.length / 2) - 1)];
  for (const key of keys) {
    await change(kv, key, (list) => {
      const kept = list.filter((s) => s.at > cutoff);
      return kept.length === list.length ? null : kept;
    });
  }
  return true;
}

/** 改一篇的快照；写满了先删旧快照腾地方再试。腾不出来时返回 false，不抛错（快照不比正文要紧）。 */
async function store(id: string, next: (list: Snapshot[]) => Snapshot[] | null): Promise<boolean> {
  const kv = await localKv();
  for (let round = 0; round <= MAKE_ROOM_ROUNDS; round++) {
    try {
      await change(kv, historyKey(id), next);
      return true;
    } catch (e) {
      if (!isQuotaError(e) || !(await makeRoom())) {
        console.warn("snapshot not saved", e);
        return false;
      }
    }
  }
  return false;
}

/**
 * 一篇换了 id（文件改名、从浏览器本地搬进文库，`fromTag` 是它原来所在的后端）：快照跟过去。`keep`：原来那篇还在（复制），快照复制一份。
 * 新 id 下已有的快照是删掉的那篇留下的，盖掉。旧 id 下没有快照时什么都不动：别的标签页已经搬过了，这时新 id 下的就是它。
 */
export async function moveHistory(from: string, to: string, fromTag = scope, keep = false) {
  const [fromKey, toKey] = [historyKey(from, fromTag), historyKey(to)];
  if (fromKey === toKey) return;
  const kv = await localKv();
  await kv.update([fromKey], ([old]) =>
    typeof old !== "string" ? { result: undefined } : { puts: { [toKey]: old }, deletes: keep ? [] : [fromKey], result: undefined },
  );
}

/** 删掉一篇的全部快照（这篇删了，或者它的 id 要给一篇新的用）：同一个 id 上的新文档不能接着旧文档的历史。 */
export async function dropHistory(id: string) {
  const kv = await localKv();
  await kv.update([], () => ({ deletes: [historyKey(id)], result: undefined }));
}

/** 无条件留一份（恢复旧版本之前，先把现在的内容存下来）。和最新一份一样时不重复存。返回存没存上。 */
export async function addSnapshot(id: string, text: string, now = Date.now()): Promise<boolean> {
  return store(id, (list) => (list[0]?.text === text ? null : [{ at: now, text }, ...list].slice(0, MAX_SNAPSHOTS)));
}

/** 一次保存成功以后调：`previous` 是被换掉的那一版，`saved` 是刚写进去的。按规则决定要不要留快照。 */
export async function noteSaved(id: string, previous: string, saved: string, now = Date.now()) {
  if (previous.trim() === "" || previous === saved) return;
  await store(id, (list) => {
    const last = list[0];
    if (last?.text === previous) return null;
    const due = !last || now - last.at >= SNAPSHOT_INTERVAL || Math.abs(saved.length - last.text.length) >= SNAPSHOT_MIN_CHANGE;
    return due ? [{ at: now, text: previous }, ...list].slice(0, MAX_SNAPSHOTS) : null;
  });
}
