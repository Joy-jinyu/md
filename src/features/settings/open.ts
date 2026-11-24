/** 设置对话框开没开。单独一个文件：命令表和顶栏要开它，对话框本身又要用命令表，放一起会互相引用。 */
import { signal } from "nsh";

export const settingsOpen = signal(false);
