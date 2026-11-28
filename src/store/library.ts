/** 文档库：有哪几篇、现在开着哪一篇、上次开的是哪一篇。界面读这里的列表，增删改名都经这里。 */
import { t } from "../i18n";
import { signal, Storage } from "nsh";
import { cleanFileStem, dirOf } from "../doc/file-name";
import { createMacLibraryDocument } from "../platform";
import { markdownTitle } from "../doc/title";
import { backendTag, documentStore, missedGatewayLibrary, releaseKeys } from "./backend";
import { renameTracked } from "./document";
import type { DocMeta, ReadResult } from "./document-store";
import { scopedKey } from "./kv";
import { buryRecord, moveSyncRecord } from "./sync-store";

const docs = signal<DocMeta[]>([]);
const current = signal<string | null>(null);

export const allDocs = () => docs();
export const currentDocId = () => current();

/** 开着的这篇最后一次出现在列表里时的名字：它在别处删掉、列表重读以后，顶栏和「存成新文档」还要用。 */
let openName = "";
function setDocs(next: DocMeta[]) {
  openName = next.find((d) => d.id === current())?.name ?? openName;
  docs.set(next);
}

/** 开着的这篇的名字（文件类后端是文件名），已经不在列表里了也给得出。 */
export const openDocName = () => docs().find((d) => d.id === current())?.name ?? openName;

/** 上次打开的那一篇的 id，放在 Storage 里（和设置一样），按后端分开：这是浏览器本地的键，别的后端是 `md.lastOpened[<后端>]`。 */
export const LAST_OPENED_KEY = "md.lastOpened";
const lastOpenedKey = () => scopedKey(LAST_OPENED_KEY, backendTag(), "");

/** 这个后端上次打开的那篇。分后端之前大家共用一个键：这个后端还没记过时退回去读它（读到的是别的后端的 id 时对不上列表，等于没有）。 */
async function lastOpened(): Promise<string | null> {
  const key = lastOpenedKey();
  return (await Storage.getItem(key)) ?? (key === LAST_OPENED_KEY ? null : await Storage.getItem(LAST_OPENED_KEY));
}
/** 存储里的兜底名（文件名、Gist 名、重名判断），不随界面语言变，否则切换语言后同一篇对不上原来的文件。 */
export const DEFAULT_NAME = "未命名";

/** 新建文档按当时的界面语言起名；建好就是普通文档名，以后切换语言不改。 */
const newDocumentName = () => t(DEFAULT_NAME, "Untitled");

export const mostRecent = (list: DocMeta[]): DocMeta | undefined => [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0];

/** 文库和同步使用的名字不随界面语言变化。 */
export const documentName = (doc: { title: string; name: string }) => doc.title || doc.name || DEFAULT_NAME;

/**
 * 文档显示的名字，顶栏、侧栏、快速打开、最近文档、删除确认都用它：正文第一个标题，没有就用文档名（文件类后端是文件名），都没有才是「未命名」。
 * 文件类后端的列表不读正文，`doc.title` 是空的，所以列表里是文件名（DESIGN.md「存在哪」）。
 */
export function displayName(doc: { title: string; name: string }): string {
  if (doc.title) return doc.title;
  const name = documentName(doc);
  // 文库里沿用原来的文件名；内置的未命名标签只在显示时翻译。
  const generated = /^未命名(?: (\d+))?$/.exec(name);
  return generated ? t(name, generated[1] ? `Untitled ${generated[1]}` : "Untitled") : name;
}

/**
 * 这次运行里读过、存过的文档的标题，只在内存里：文件类后端的列表不读正文（`doc.title` 是空的），
 * 快速打开靠它按标题找到打开过、存过的那几篇。没打开过的还是只能按文件名找。
 */
const seenTitles = new Map<string, string>();

export const knownTitle = (doc: { id: string; title: string }) => doc.title || seenTitles.get(doc.id) || "";

/** 读出、写进一篇时记下它的标题。 */
export function noteTitle(id: string, text: string) {
  seenTitles.set(id, markdownTitle(text));
}

/** 开着的这篇显示的名字：标题用编辑器里最新的（还没存的也算），没有标题时用它在文档库里的名字。 */
export const openDisplayName = (liveTitle: string) => displayName({ title: liveTitle, name: openDocName() });

/** 名字落成文件以后的样子（清洗过、不分大小写，访达默认不分）：两篇这个一样就是重名。 */
const fileKey = (dir: string, name: string) => `${dir}${cleanFileStem(name) || DEFAULT_NAME}`.toLowerCase();

/** 和已有的名字重了就加序号（`未命名 2`）：以后存成真实文件时名字就是文件名，不能重。新建的都在最上层。 */
export function uniqueName(base: string, list: DocMeta[], dir = ""): string {
  const taken = new Set(list.filter((d) => dirOf(d.id) === dir).map((d) => fileKey(dir, d.name)));
  if (!taken.has(fileKey(dir, base))) return base;
  let n = 2;
  while (taken.has(fileKey(dir, `${base} ${n}`))) n++;
  return `${base} ${n}`;
}

export async function refreshLibrary(): Promise<DocMeta[]> {
  const list = await documentStore.list();
  setDocs(list);
  return list;
}

/** 启动时定下先开哪一篇：上次开的那篇还在就是它，不然是最近改过的；一篇都没有就建一篇空的。 */
export async function startLibrary(): Promise<string> {
  // 打不开的（不是 UTF-8、太大）不当成启动时开的那篇
  const list = (await refreshLibrary()).filter((d) => !d.problem);
  if (list.length === 0) return (await createDocument("")).id;
  const last = await lastOpened().catch((e: unknown) => {
    console.warn("last opened document unreadable", e);
    return null;
  });
  return list.find((d) => d.id === last)?.id ?? (mostRecent(list) as DocMeta).id;
}

/**
 * 记下现在开着哪一篇；记不进去（存储满了）只影响下次先开哪篇，不打断。
 * 这次没连上上次用的网关、临时用浏览器本地时不记：下次连上网关还开原来那篇。
 */
export function markOpened(id: string) {
  current.set(id);
  openName = docs().find((d) => d.id === id)?.name ?? "";
  if (missedGatewayLibrary() !== null) return;
  Storage.setItem(lastOpenedKey(), id).catch((e: unknown) => console.warn("last opened document not saved", e));
}

/** 一篇的说明变了（刚写过、改过名）：换掉列表里那一项。 */
export function noteMeta(meta: DocMeta) {
  const list = docs();
  setDocs(list.some((d) => d.id === meta.id) ? list.map((d) => (d.id === meta.id ? meta : d)) : [...list, meta]);
}

export async function createDocument(text: string, name = newDocumentName(), folder?: string, sourceId?: string): Promise<DocMeta> {
  const next = uniqueName(name, docs(), folder ? `${folder}/` : "");
  const meta = folder !== undefined
    ? await createMacLibraryDocument(next, text, folder, sourceId)
    : await documentStore.create(next, text);
  await releaseKeys(meta.id).catch((e: unknown) => console.warn("old keys not released", e));
  noteMeta(meta);
  return meta;
}

/** 改名；和别的文档重名时抛错，不自己加序号（用户亲手起的名字，悄悄改掉会让人找不到）。 */
export async function renameDocument(id: string, name: string): Promise<DocMeta> {
  const clean = name.trim();
  const key = fileKey(dirOf(id), clean);
  if (docs().some((d) => d.id !== id && fileKey(dirOf(d.id), d.name) === key)) throw new Error(t(`已经有一篇叫「${clean}」的文档了，换一个名字`, `A document named “${clean}” already exists. Enter a different name.`));
  const meta = await renameTracked(id, () => documentStore.rename(id, clean));
  if (meta.id !== id) {
    // 新名字上可能留着删掉的那篇的同步记录：先挪成墓碑，这篇没有记录时也不能接着推进那个 Gist
    await buryRecord(meta.id).catch((e: unknown) => console.warn("old sync record not buried", e));
    await moveSyncRecord(id, meta.id).catch((e: unknown) => console.warn("sync record not moved", e));
  }
  const title = seenTitles.get(id);
  if (meta.id !== id && title !== undefined) seenTitles.set(meta.id, title);
  // 文件类后端改名会换 id：列表里换掉旧的那一项，开着的是它就跟着换
  setDocs([...docs().filter((d) => d.id !== id && d.id !== meta.id), meta]);
  if (current() === id && meta.id !== id) markOpened(meta.id);
  return meta;
}

/** 删掉一篇，连同它的版本历史；同步记录挪成墓碑（见 `releaseKeys`）。 */
export async function removeDocument(id: string) {
  await documentStore.remove(id);
  setDocs(docs().filter((d) => d.id !== id));
  await releaseKeys(id).catch((e: unknown) => console.warn("keys of removed document not released", e));
}

export const readDocument = (id: string): Promise<ReadResult | null> => documentStore.read(id);
