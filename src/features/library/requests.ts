/** 文档库的请求和弹框开关：侧栏、命令表、文件操作发出，编辑页那一层接（只有它能先存好当前这篇、再换一篇、重建编辑器）。 */
import { signal } from "nsh";

export type LibraryRequest =
  /** 打开一篇；`find` 是打开后要查找并跳过去的词（全文搜索的结果）。 */
  | { kind: "open"; id: string; find?: string }
  /** 先打开这一篇，再显示它的版本历史。 */
  | { kind: "history"; id: string }
  | { kind: "create"; folder?: string }
  | { kind: "duplicate"; id: string }
  /** 把读进来的文件存成一篇新文档并打开。 */
  | { kind: "import"; name: string; text: string }
  /** 打开系统交来的文件（绝对路径）：在文库里就直接打开，不在就导入一份副本。 */
  | { kind: "openPath"; path: string }
  | { kind: "remove"; id: string }
  /** 把现在这篇换成一个旧版本。 */
  | { kind: "restore"; text: string }
  /** 开着的这篇在别处删掉了：把这里的内容存成一篇新文档（`rescue`），或者不要了（`abandon`）。 */
  | { kind: "rescue" }
  | { kind: "abandon" };

/** 还没处理的请求。带一个序号：同一个请求连发两次也算两次。 */
export const libraryRequest = signal<{ request: LibraryRequest; seq: number } | null>(null);

let seq = 0;

export function requestLibrary(request: LibraryRequest) {
  seq += 1;
  libraryRequest.set({ request, seq });
}

/** 快速打开（按名字找文档）的面板开没开。 */
export const quickOpenOpen = signal(false);
/** 版本历史对话框开没开。 */
export const historyOpen = signal(false);
/** 刚打开的那篇（`id`）里要查找的词：那篇的编辑页接到后打开查找条、跳到第一处，然后清掉。带 id 是因为换文档时旧编辑页还没卸下，不能让它接走。 */
export const pendingFind = signal<{ id: string; query: string } | null>(null);
