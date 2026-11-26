/**
 * 接文档库的请求（打开、新建、导入、删除、恢复旧版本、处理在别处删掉的这篇）。换一篇之前先把当前这篇写完；写不进去就不换，说明原因。
 * `show(id, find)` 由编辑页给：读出那一篇、重建编辑器；读不到（已经不在了）返回 false。
 */
import { type Phrase, t } from "../../i18n";
import { messageOf } from "../../doc/message";
import { locateOpenedFile } from "../../platform";
import { storageKind } from "../../store/backend";
import { closeDocument, discardDocument, flush, holdDocument, latestDocument, replaceDocument, type SaveResult, STALE } from "../../store/document";
import { addSnapshot } from "../../store/history";
import { allDocs, createDocument, currentDocId, displayName, mostRecent, openDocName, refreshLibrary, removeDocument } from "../../store/library";
import { problemText } from "./external";
import { clearWarning, say } from "./receipt";
import type { LibraryRequest } from "./requests";
import { historyOpen, pendingFind } from "./requests";

type Show = (id: string, find?: string) => Promise<boolean>;

function whyNotSaved(result: Extract<SaveResult, { ok: false }>, what: string): string {
  if (result.error.deleted) return t(`这篇已经在别处删除了，先在上面选「存成新文档」或「放弃这篇」，再${what}。`, `This document was deleted elsewhere. Choose “Save as new document” or “Discard document” above before you ${what}.`);
  if (result.error.conflict) return t(`这篇在别处改过、和这里的修改冲突，先在上面选保留哪一边，再${what}。`, `This document was edited elsewhere and conflicts with your changes. Choose which version to keep above before you ${what}.`);
  if (result.error.quota) return t(`本机存储已满，这篇最近的修改没存上，先不${what}。删掉不用的文档腾出空间后再试。`, `Storage is full, so recent changes could not be saved. Free up space and try to ${what} again.`);
  return t(`这篇没能保存（${result.error.detail}），先不${what}。`, `Could not save this document (${result.error.detail}). Could not ${what}.`);
}

/** 这篇现在的名字，留到回执显示时再按语言取：先记下文档，删掉以后回执里还是它的名字。 */
const nameOf = (id: string) => {
  const doc = allDocs().find((d) => d.id === id);
  return () => (doc ? displayName(doc) || t("未命名", "Untitled") : t("这篇文档", "this document"));
};

/** 要开的那篇不在了：重读列表，开最近改过的一篇（一篇都没有就新建一篇空的）。 */
export async function openFallback(show: Show): Promise<boolean> {
  const next = mostRecent(await refreshLibrary()) ?? (await createDocument(""));
  return show(next.id);
}

export function createLibraryActions(show: Show) {
  /** 关掉当前这篇；关不掉时说明原因，返回 false。 */
  const leave = async (what: () => string): Promise<boolean> => {
    const result = await closeDocument();
    if (!result.ok) say(() => whyNotSaved(result, what()), "warn");
    return result.ok;
  };
  /** 打开 `id`；不在了就回到 `back` 那篇（回不去就开最近的）。 */
  const go = async (id: string, back: string | null, find?: string) => {
    if (await show(id, find)) return;
    await refreshLibrary();
    say(() => t("这篇文档已经不在了（可能在别的标签页里删掉了）。", "This document is no longer available. It may have been deleted in another tab."), "warn");
    if (!back || !(await show(back))) await openFallback(show);
  };

  const open = async (id: string, find?: string) => {
    clearWarning();
    const problem = allDocs().find((d) => d.id === id)?.problem;
    const name = nameOf(id);
    if (problem) return say(() => t(`「${name()}」${problemText(problem)}。`, `${name()}: ${problemText(problem)}.`), "warn");
    const from = currentDocId();
    if (id === from) {
      if (find) pendingFind.set({ id, query: find });
      return;
    }
    if (await leave(() => t("切换", "switch documents"))) await go(id, from, find);
  };

  const history = async (id: string) => {
    await open(id);
    if (currentDocId() === id) historyOpen.set(true);
  };

  /** 新建（`text` 为空）或导入：先关当前这篇，再建；建不成就回到当前这篇。`note` 换掉导入成功后的那句回执。 */
  const create = async (text: string, name?: string, note?: Phrase) => {
    clearWarning();
    const from = currentDocId();
    if (!(await leave(() => (name ? t("打开文件", "open the file") : t("新建", "create a document"))))) return;
    try {
      const meta = await createDocument(text, name);
      await go(meta.id, from);
      if (name) say(note ?? (() => t(`已打开「${name}」，存成了文档库里的一篇新文档。`, `Opened “${name}” as a new document in the library.`)), "info");
    } catch (e) {
      console.error("create document failed", e);
      say(() => t(`没能${name ? `打开「${name}」` : "新建文档"}：${messageOf(e)}`, `${name ? `Could not open “${name}”` : "Could not create a document"}: ${messageOf(e)}`), "warn");
      if (from) await show(from);
    }
  };

  /**
   * 系统交来的文件（macOS 的打开方式、拖进窗口）：在文库里就直接打开它；不在的话应用只能读文库和「下载」，
   * 读得到就导入一份副本到文库，读不到就说明怎么办（nsh 不因为「用它打开」就给这个文件的读写权限）。
   */
  const openPath = async (path: string) => {
    const found = await locateOpenedFile(path);
    if (found.kind === "library") {
      await refreshLibrary();
      return open(found.id);
    }
    const k = storageKind();
    const folder = () => (k.kind === "files" ? k.folder : t("文库", "Library"));
    if (found.text === null) return say(() => t(`「${found.name}」不在文库（${folder()}）里，应用没有权限读它。把它挪进文库文件夹，或者用「打开文件」选它导入一份。`, `“${found.name}” is outside the library (${folder()}), and Pairdown cannot read it there. Move it into the library folder or use Open File to import a copy.`), "warn");
    await create(found.text, found.name, () => t(`「${found.name}」不在文库（${folder()}）里，应用改不了原文件，已导入一份副本到文库。`, `“${found.name}” is outside the library (${folder()}). Pairdown imported a copy into the library because it cannot edit the original.`));
  };

  const remove = async (id: string) => {
    const name = nameOf(id);
    // 删的是开着的这篇：先停下自动保存，免得删完又被写回去；没存的改动等删成了再丢，删不成接着存
    const resume = id === currentDocId() ? await holdDocument() : null;
    try {
      await removeDocument(id);
    } catch (e) {
      console.error("remove document failed", e);
      say(() => t(`没能删除「${name()}」：${messageOf(e)}`, `Could not delete “${name()}”: ${messageOf(e)}`), "warn");
      resume?.();
      return;
    }
    say(() => t(`已删除「${name()}」。`, `Deleted “${name()}”.`), "info");
    if (!resume) return;
    discardDocument();
    await openFallback(show);
  };

  const restore = async (text: string) => {
    const id = currentDocId();
    if (!id) return;
    const saved = await flush();
    if (!saved.ok) return say(() => whyNotSaved(saved, t("恢复", "restore this version")), "warn");
    const mine = latestDocument();
    if (!(await addSnapshot(id, mine))) return say(() => t("没能把现在的内容先存成一个版本（存储满了），没有恢复。", "Could not save a version of the current content because storage is full. No version was restored."), "warn");
    // 存进历史要等一会儿，这期间又打的字、别处存的改动由 replaceDocument 在同一个排队任务里拦下（和同步拉取一样）
    const result = await replaceDocument(text, { id, text: mine });
    if (result === STALE) return say(() => t("恢复的时候这篇又改了，没有恢复。再点一次「恢复这个版本」。", "The document changed during the restore. Select “Restore this version” again."), "warn");
    if (!result.ok) return say(() => whyNotSaved(result, t("恢复", "restore this version")), "warn");
    await show(id);
    say(() => t("已恢复到这个版本。恢复前的内容在版本历史里。", "Restored this version. The previous content is in Version History."), "info");
  };

  /**
   * 开着的这篇在别处删了，选「存成新文档」：先建新的，建成了才丢开旧的；建不成什么都不动，内容还在编辑器里。
   * 名字沿用原来的（被占了再加序号）：回到窗口时列表已经重读过、里面没有这篇了，所以名字取 `openDocName`。
   */
  const rescue = async () => {
    const id = currentDocId();
    if (!id) return;
    let meta;
    try {
      meta = await createDocument(latestDocument(), openDocName() || undefined);
    } catch (e) {
      console.error("rescue document failed", e);
      return say(() => t(`没能存成新文档：${messageOf(e)}。内容还在这里，可以先用「另存为」存成文件。`, `Could not save a new document: ${messageOf(e)}. Your content is still here. Use Save As to keep a file copy.`), "warn");
    }
    discardDocument();
    if (!(await show(meta.id))) await openFallback(show);
    say(() => t(`已把这里的内容存成新文档「${displayName(meta) || meta.name}」。`, `Saved your content as a new document: “${displayName(meta) || meta.name}”.`), "info");
  };

  const abandon = async () => {
    discardDocument();
    await openFallback(show);
    say(() => t("已放弃这篇在别处删掉的文档。", "Discarded your copy of the document that was deleted elsewhere."), "info");
  };

  return (request: LibraryRequest) => {
    const run = async () => {
      switch (request.kind) {
        case "open":
          return open(request.id, request.find);
        case "history":
          return history(request.id);
        case "create":
          return create("");
        case "import":
          return create(request.text, request.name);
        case "openPath":
          return openPath(request.path);
        case "remove":
          return remove(request.id);
        case "restore":
          return restore(request.text);
        case "rescue":
          return rescue();
        case "abandon":
          return abandon();
      }
    };
    return run().catch((e: unknown) => {
      console.error("library request failed", request.kind, e);
      say(() => t(`出错了：${messageOf(e)}`, `Something went wrong: ${messageOf(e)}`), "warn");
    });
  };
}
