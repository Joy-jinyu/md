/** 设置对话框开没开。单独一个文件：命令表和顶栏要开它，对话框本身又要用命令表，放一起会互相引用。 */
import { signal } from "nsh";

export const settingsOpen = signal(false);

/** 打开时直接翻到哪一页（顶上的存储提示「去设置页」用）；打开以后清掉。 */
export const settingsPage = signal<"storage" | null>(null);
