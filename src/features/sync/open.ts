/** 同步面板开没开、正在对比哪一件冲突。单独一个文件：命令表、顶栏、面板都要用，放一起会互相引用。 */
import { signal } from "nsh";

export const syncOpen = signal(false);
/** 正在看哪一篇的冲突对比（文档 id）；null 是在看同步面板本身。 */
export const comparing = signal<string | null>(null);
