/**
 * 现在开着的那一篇（Markdown 原文）：读出、停手后写入、立即写入、和别处的改动比对。
 * 写的时候带上读出时的版本：存储里的版本变了（另一个标签页存过）就不覆盖，状态变成 conflict，等用户在界面上选。
 * 别处把这篇删了也是 conflict（`deleted`），等用户选存成新文档还是放弃。
 * 写入一次只跑一个（排队），不然前一次还没写完、后一次带着旧版本去写，会被当成冲突。
 */
import { t } from "../i18n";
import { signal } from "nsh";
import { documentStore, elsewhereWords } from "./backend";
import type { DocMeta, Version, WriteResult } from "./document-store";
import { addSnapshot, dropHistory, makeRoom, moveHistory, noteSaved } from "./history";
import { isQuotaError } from "./kv";
import { noteMeta, noteTitle } from "./library";
import { dropStash, writeStash } from "./unsaved";

/** 停止编辑后多久写一次（毫秒），实施计划 4.5 定的值。 */
const SAVE_DELAY = 800;

/** 写不进去的原因：`quota` 是存储满了，`conflict` 是别处改过、`deleted` 是别处删了（这两种等用户选），其余放在 `detail` 里。 */
export interface SaveError {
  quota: boolean;
  conflict: boolean;
  deleted: boolean;
  detail: string;
}

export type SaveState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saved" }
  | { kind: "error"; error: SaveError }
  /** `deleted`：不是别处改过，是别处把这篇删了。 */
  | { kind: "conflict"; deleted: boolean };

export type SaveResult = { ok: true } | { ok: false; error: SaveError };

const OK: SaveResult = { ok: true };
const CONFLICT = (): SaveResult => ({ ok: false, error: { quota: false, conflict: true, deleted: false, detail: t(`${elsewhereWords().changed}，和这里没存的修改冲突`, `${elsewhereWords().changed} and conflicts with your unsaved edits`) } });
const DELETED = (): SaveResult => ({ ok: false, error: { quota: false, conflict: false, deleted: true, detail: elsewhereWords().deleted } });

/** 冲突时选了一边，但被放弃的那一边存不进版本历史（存储满了）：这时什么都不动。 */
const historyFull = (what: string): SaveResult => ({
  ok: false,
  error: { quota: true, conflict: false, deleted: false, detail: t(`本机存储已满，${what}存不进版本历史，所以这次没有动。先用「另存为」把这里的内容存成文件，或者删掉不用的文档腾出空间，再选一次。`, `Storage is full, so ${what} could not be saved to version history. Use Save As to keep a copy or free storage and try again.`) },
});

const state = signal<SaveState>({ kind: "idle" });
let openId: string | null = null;
/** 读出（或上次写成）时存储里的版本。 */
let base: Version = 0;
/** 存储里现在的正文，相同就不再写。 */
let stored = "";
/** 取最新 Markdown 的函数；有它说明还有改动没写。 */
let produce: (() => string) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
/** 这一篇正在关（切到别的文档、整篇换掉、载入别处的版本）：编辑页重新载入之前，旧编辑器报来的改动一律不收，不然会写错地方。 */
let closed = true;
/** 正在删开着的这篇：改动照收，但先不写（删成了就丢掉，没删成接着写）。 */
let held = false;
/** 上次没写成、但不知道到底落没落盘的内容（网关在回复之前断了）：存储里正好是它，就是自己写的，不算别处改过。 */
let attempted: string | null = null;
let queue: Promise<unknown> = Promise.resolve();

export const saveState = () => state();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

function stopTimer() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}

function conflict(deleted: boolean): SaveResult {
  stopTimer();
  state.set({ kind: "conflict", deleted });
  return deleted ? DELETED() : CONFLICT();
}

/** 读出一篇并把它当成现在开着的；没有这一篇是 null。之前那篇要先 `closeDocument`。 */
export async function openDocument(id: string): Promise<string | null> {
  const read = await enqueue(() => documentStore.read(id));
  if (!read) return null;
  noteTitle(id, read.text);
  stopTimer();
  openId = id;
  base = read.version;
  stored = read.text;
  produce = null;
  closed = false;
  held = false;
  attempted = null;
  state.set({ kind: "idle" });
  await documentStore.sweepAssets?.(id, read.text).catch((e: unknown) => console.warn("unused images not swept", id, e));
  return read.text;
}

/**
 * 文档改了：记下怎么取最新的 Markdown，停手 800ms 后再取、再写。
 * 取 Markdown 可能较重，所以传函数，等写的时候才调。冲突没解决时只记下，不去写。
 */
export function markChanged(next: () => string) {
  if (closed) return;
  produce = next;
  if (state().kind === "conflict" || held) return;
  state.set({ kind: "pending" });
  stopTimer();
  timer = setTimeout(() => void flush(), SAVE_DELAY);
}

/** 这篇文档现在的 Markdown：有还没写进存储的改动就现取。 */
export function latestDocument(): string {
  return produce ? produce() : stored;
}

/**
 * 页面要关了、切到后台了：把还没写进存储的改动同步记进应急键（见 unsaved.ts），下次启动时并回去。
 * 返回能不能放心走：没有要记的、或者记下了且估计放得下是 true。
 */
export function stashUnsaved(): boolean {
  const id = openId;
  if (!produce || !id || closed) return true;
  let text: string;
  try {
    text = produce();
  } catch (e) {
    console.error("unsaved text unreadable", e);
    return false;
  }
  return text === stored || writeStash({ id, base, text });
}

/** 写正文；存储满了先删旧的版本快照腾地方再写（正文优先）。 */
async function writeMakingRoom(id: string, text: string): Promise<WriteResult> {
  for (;;) {
    try {
      return await documentStore.write(id, text, base);
    } catch (e) {
      if (!isQuotaError(e) || !(await makeRoom())) throw e;
    }
  }
}

function toSaveError(e: unknown): SaveError {
  return { quota: isQuotaError(e), conflict: false, deleted: false, detail: e instanceof Error ? e.message : String(e) };
}

/** 写不进去：改动留着等下次写；已经取出的文字先记进应急键（网关断开、存储满了时，关掉页面也不丢）。 */
function fail(next: () => string, e: unknown, text?: string): SaveResult {
  produce = produce ?? next;
  if (text !== undefined) attempted = text;
  if (text !== undefined && openId) writeStash({ id: openId, base, text });
  const error = toSaveError(e);
  state.set({ kind: "error", error });
  return { ok: false, error };
}

/** 没有没写的改动了：状态是「已保存」，应急键也不用留。 */
function settle(id: string): SaveResult {
  if (!produce) {
    state.set({ kind: "saved" });
    dropStash(id);
  }
  return OK;
}

/** 写成了：记下新版本，按规则留版本快照（快照失败不影响这次保存）。 */
function written(id: string, text: string, result: Extract<WriteResult, { ok: true }>) {
  const previous = stored;
  base = result.meta.version;
  stored = text;
  attempted = null;
  noteMeta(result.meta);
  noteTitle(result.meta.id, text);
  noteSaved(id, previous, text).catch((e: unknown) => console.warn("snapshot skipped", e));
}

async function flushNow(): Promise<SaveResult> {
  stopTimer();
  const next = produce;
  const id = openId;
  if (!next || !id || closed || held) return OK;
  const now = state();
  if (now.kind === "conflict") return now.deleted ? DELETED() : CONFLICT();
  produce = null;
  let text: string;
  try {
    text = next();
  } catch (e) {
    return fail(next, e);
  }
  if (text === stored) return settle(id);
  try {
    const result = await writeMakingRoom(id, text);
    if (!result.ok) {
      const now = await documentStore.read(id);
      // 上次写进去了、只是回复丢了（断线）：存储里和这里一字不差，就当已经存好了
      if (now?.text === text) return adopt(id, now.version, text);
      produce = produce ?? next;
      return conflict(now === null);
    }
    written(id, text, result);
  } catch (e) {
    return fail(next, e, text);
  }
  return settle(id);
}

/** 存储里那一版其实就是这里的内容：认下它的版本，当成已保存。 */
function adopt(id: string, version: Version, text: string): SaveResult {
  base = version;
  stored = text;
  attempted = null;
  return settle(id);
}

/** 立即写入还没写的改动（失焦、切到后台、退出、切文档前调）。写不进去时结果里带原因，状态也变成 error 或 conflict；改动留着。 */
export const flush = (): Promise<SaveResult> => enqueue(flushNow);

/** 关掉这一篇（要切到别的文档）：先把改动写完，写成了以后不再收旧编辑器的改动。写不进去时不关，结果里带原因。 */
export async function closeDocument(): Promise<SaveResult> {
  return enqueue(async () => {
    let result = await flushNow();
    // 写的过程中又打了字，接着写
    while (result.ok && produce) result = await flushNow();
    if (result.ok) closed = true;
    return result;
  });
}

/** 这一篇要删掉了（或者在别处删了、用户选了放弃）：没写的改动不要了。 */
export function discardDocument() {
  stopTimer();
  if (openId) dropStash(openId);
  produce = null;
  closed = true;
  held = false;
  openId = null;
}

/**
 * 要删开着的这篇：等手上的写入跑完，先不再写，没写的改动留着。
 * 删成了调 `discardDocument`；没删成调返回的函数，接着自动保存。
 */
export async function holdDocument(): Promise<() => void> {
  await enqueue(async () => {
    stopTimer();
    held = true;
  });
  return () => {
    held = false;
    if (produce && state().kind !== "conflict") {
      state.set({ kind: "pending" });
      timer = setTimeout(() => void flush(), SAVE_DELAY);
    }
  };
}

/** 换之前这篇应该是什么样：开着的是 `id`、存储里和编辑器里都还是 `text`（同步拉取时判定用的那版）。 */
export interface Expected {
  id: string;
  text: string;
}

/** 判定以后这篇又变了（又打了字、别处存过、换了一篇开着）：同步拉取不换，下次再比。 */
export const STALE: Extract<SaveResult, { ok: false }> = { ok: false, error: { quota: false, conflict: false, deleted: false, get detail() { return t("同步时这篇又改了，没有换。再同步一次。", "The document changed during sync. No replacement was made. Try syncing again."); } } };

function changedSince(expected: Expected): boolean {
  if (closed || openId !== expected.id || state().kind === "conflict" || stored !== expected.text) return true;
  try {
    return latestDocument() !== expected.text;
  } catch (e) {
    console.warn("unsaved text unreadable", e);
    return true;
  }
}

/**
 * 把整篇换成 `text` 并立即写入（恢复旧版本、同步拉取时用）。写不进去时什么都不变：原来没写的改动还留着。
 * `expected`：和「这篇还是不是判定时那样」的比对放在同一个排队任务里，中间插不进别的写入和打字；不是了就返回 `STALE`，什么都不动。
 * 写成了以后调用方必须重新载入编辑页（`openDocument`）：在那之前这里不再收改动。
 */
export function replaceDocument(text: string, expected?: Expected): Promise<SaveResult> {
  return enqueue(async () => {
    const id = openId;
    if (!id) return OK;
    if (expected && changedSince(expected)) return STALE;
    stopTimer();
    const pending = produce;
    const before = state();
    produce = null;
    closed = true;
    const restore = () => {
      closed = false;
      produce = pending;
      state.set(before);
      if (pending && before.kind !== "conflict") timer = setTimeout(() => void flush(), SAVE_DELAY);
    };
    try {
      const result = await writeMakingRoom(id, text);
      if (!result.ok) {
        restore();
        return CONFLICT();
      }
      written(id, text, result);
    } catch (e) {
      // 没换成：这次失败由调用方另外说明，保存状态回到之前
      restore();
      return { ok: false, error: toSaveError(e) };
    }
    dropStash(id);
    state.set({ kind: "saved" });
    return OK;
  });
}

/**
 * 冲突时选「保留我的」：别处那一版先存进版本历史，再用这里的内容盖过去。
 * 别处那一版存不进历史（存储满了）就不盖；这篇在别处删了就变成「已删除」的冲突。
 */
export function keepMine(): Promise<SaveResult> {
  return enqueue(async () => {
    const id = openId;
    const now = state();
    if (!id || now.kind !== "conflict") return OK;
    if (now.deleted) return DELETED();
    const mine = latestDocument();
    const theirs = await documentStore.read(id);
    if (!theirs) return conflict(true);
    if (theirs.text !== mine && !(await addSnapshot(id, theirs.text))) return historyFull(t("别处那一版", "the version from elsewhere"));
    base = theirs.version;
    // 比较的是存储里现在那一版：这里的内容恰好等于当初读出的那版时，也要写回去盖掉别处的
    stored = theirs.text;
    produce = produce ?? (() => mine);
    state.set({ kind: "pending" });
    return flushNow();
  });
}

/**
 * 冲突时选「载入外面的」：这里没存的内容先存进版本历史，成了以后调用方重新载入编辑页（`openDocument`）。
 * 存不进历史（存储满了）就不动；这篇在别处删了就变成「已删除」的冲突。两种都在结果里带原因。
 */
export function takeTheirs(): Promise<SaveResult> {
  return enqueue(async () => {
    const id = openId;
    if (!id) return OK;
    if ((await documentStore.read(id)) === null) return conflict(true);
    const mine = latestDocument();
    if (mine !== stored && !(await addSnapshot(id, mine))) return historyFull(t("这里没存的内容", "your unsaved content"));
    stopTimer();
    dropStash(id);
    produce = null;
    closed = true;
    return OK;
  });
}

/**
 * 窗口重新获得焦点时调：存储里的版本比这里读出的新，说明别处（另一个标签页）存过。
 * 这里没改过：`reload`，调用方直接重新载入；这里也改过：状态变成 conflict，等用户选。别处删了这篇也是 conflict（`deleted`）。
 */
export function checkExternal(): Promise<"same" | "reload" | "conflict"> {
  return enqueue(async () => {
    const id = openId;
    if (!id || closed) return "same";
    const now = await documentStore.read(id);
    if (openId !== id) return "same";
    if (!now) {
      conflict(true);
      return "conflict";
    }
    if (now.version === base) return "same";
    // 断线前写进去了、只是没收到回复：是自己写的那一版。还有没写的改动就接着存
    if (now.text === attempted) {
      adopt(id, now.version, now.text);
      if (produce) {
        state.set({ kind: "pending" });
        stopTimer();
        timer = setTimeout(() => void flush(), SAVE_DELAY);
      }
      return "same";
    }
    if (produce || state().kind === "error") {
      conflict(false);
      return "conflict";
    }
    closed = true;
    return "reload";
  });
}

/**
 * 给一篇改名；后端用文件名当 id 时改名会换 id（网关、文件夹）。先把开着这篇没写的改动写完（不然会写到旧名字上），
 * 改成以后开着的这篇跟着换 id，版本历史和应急键也跟过去。`rename` 是真正去改名的那一步。
 */
export function renameTracked(id: string, rename: () => Promise<DocMeta>): Promise<DocMeta> {
  return enqueue(async () => {
    const open = openId === id;
    const saved = open ? await flushNow() : OK;
    if (!saved.ok) throw new Error(t(`这篇还有修改没存上，先不改名（${saved.error.detail}）`, `Could not rename this document because there are unsaved changes (${saved.error.detail})`));
    const meta = await rename();
    if (meta.id === id) return meta;
    // 新名字上可能留着删掉的那篇的历史：先删，这篇没有历史时也不能接着它的
    await dropHistory(meta.id).catch((e: unknown) => console.warn("old history not dropped", e));
    await moveHistory(id, meta.id).catch((e: unknown) => console.warn("history not moved", e));
    retarget(id, meta.id);
    return meta;
  });
}

function retarget(from: string, to: string) {
  if (openId !== from) return;
  dropStash(from);
  openId = to;
}

/** 别处（另一个标签页）把开着的这篇改了名：跟到新名字上，接着往那里存。 */
export function followRename(from: string, to: string): Promise<void> {
  return enqueue(async () => retarget(from, to));
}
