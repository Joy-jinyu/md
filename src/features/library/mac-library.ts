import { Clipboard, signal, Storage, type Point } from "nsh";
import { messageOf } from "../../doc/message";
import { t } from "../../i18n";
import { createMacLibraryFolder, macLibraryFolders, macLibraryInfo, macLibraryPath, revealInFinder, showDocumentMenu } from "../../platform";
import type { DocMeta } from "../../store/document-store";
import { say } from "./receipt";
import { requestLibrary } from "./requests";
import { panel } from "./panel-state";

const VIEW_KEY = "md.macosLibraryView";
const view = signal<"articles" | "tree">("articles");
const folders = signal<string[]>([]);
const expanded = signal<ReadonlySet<string>>(new Set());
export const newFolderParent = signal<string | null>(null);
export const fileInfo = signal<{ path: string; name: string; size: number; updatedAt: number } | null>(null);

let restored = false;
let viewChanged = false;
export function restoreMacLibraryView() {
  if (restored) return;
  restored = true;
  void Storage.getItem(VIEW_KEY).then((saved) => {
    if (!viewChanged && saved === "tree") view.set(saved);
  }).catch((error: unknown) => console.warn("读取文库视图失败", error));
}

let scan = 0;
export async function refreshMacFolders() {
  const version = ++scan;
  try {
    const next = await macLibraryFolders();
    if (version === scan) folders.set(next);
  } catch (error) {
    if (version === scan) say(() => t(`没能读取文件夹：${messageOf(error)}`, `Could not read folders: ${messageOf(error)}`), "warn");
  }
}

function setView(mode: "articles" | "tree") {
  viewChanged = true;
  view.set(mode);
  void Storage.setItem(VIEW_KEY, mode).catch((error: unknown) => console.warn("未能记住文库视图", error));
}

export const macLibraryView = view;
/** 换文库视图并记住（菜单栏「文章」「文件树」用）。 */
export const setMacLibraryView = setView;
export const macFolders = folders;
export const folderExpanded = (path: string) => expanded().has(path);

export function toggleFolder(path: string) {
  const next = new Set(expanded());
  if (next.has(path)) next.delete(path);
  else next.add(path);
  expanded.set(next);
}

export async function addFolder(parent: string, name: string) {
  const path = await createMacLibraryFolder(parent, name);
  if (parent && !folderExpanded(parent)) toggleFolder(parent);
  if (!folderExpanded(path)) toggleFolder(path);
  setView("tree");
  await refreshMacFolders();
}

function report(operation: () => Promise<void>) {
  void operation().catch((error: unknown) => say(() => messageOf(error), "warn"));
}

type MenuTarget = { folder: string; doc?: DocMeta; open?: () => void; focusSearch: () => void };

export function showMacLibraryMenu(target: MenuTarget, anchor?: Point) {
  const doc = target.doc;
  const path = () => macLibraryPath(doc?.id ?? target.folder, !doc);
  return showDocumentMenu([
    target.open ? { label: t("打开", "Open"), onSelect: target.open } : null,
    doc ? {
      label: t("在新窗口打开", "Open in New Window"),
      disabled: !!doc.problem,
      onSelect: () => report(async () => (await import("../editor/DocumentWindow")).openDocumentWindow(doc.id)),
    } : null,
    target.open ? { type: "separator" } : null,
    { label: t("新建文件", "New File"), onSelect: () => requestLibrary({ kind: "create", folder: target.folder }) },
    { label: t("新建文件夹…", "New Folder…"), onSelect: () => newFolderParent.set(target.folder) },
    { type: "separator" },
    { label: t("搜索", "Search"), onSelect: target.focusSearch },
    { type: "separator" },
    { label: t("文章（列表视图）", "Articles (List View)"), checked: view() === "articles", onSelect: () => setView("articles") },
    { label: t("文件树（树状视图）", "File Tree (Tree View)"), checked: view() === "tree", onSelect: () => setView("tree") },
    ...(doc ? [
      { type: "separator" as const },
      { label: t("制作副本", "Duplicate"), disabled: !!doc.problem, onSelect: () => requestLibrary({ kind: "duplicate", id: doc.id }) },
      { label: t("改文库名…", "Rename…"), onSelect: () => panel.renaming.set(doc) },
      { label: t("版本历史…", "Version History…"), onSelect: () => requestLibrary({ kind: "history", id: doc.id }) },
      { type: "separator" as const },
      { label: t("显示简介…", "Get Info…"), onSelect: () => report(async () => {
        fileInfo.set({ ...await macLibraryInfo(doc.id), name: doc.id.slice(doc.id.lastIndexOf("/") + 1) });
      }) },
      { label: t("删除…", "Delete…"), onSelect: () => panel.deleting.set(doc) },
    ] : []),
    { type: "separator" },
    {
      label: t("复制文件路径", "Copy File Path"),
      onSelect: () => report(async () => {
        if (await Clipboard.writeText(await path()) === "failed") throw new Error(t("没能复制文件路径。", "Could not copy the file path."));
      }),
    },
    { label: t("在访达中显示", "Reveal in Finder"), onSelect: () => report(() => revealInFinder(doc?.id ?? target.folder, !doc)) },
  ], anchor);
}
