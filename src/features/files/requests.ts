/** 「打开文件」「另存为」「导出为 HTML」的请求：命令表和顶栏发出，编辑页那一层接（它才能把整篇换掉、重建编辑器）。 */
import { signal } from "nsh";

export type FileRequest = "open" | "saveAs" | "exportHtml";

/** 还没处理的请求。带一个序号：同一个请求连发两次也算两次。 */
export const fileRequest = signal<{ kind: FileRequest; seq: number } | null>(null);

let seq = 0;

export function requestFile(kind: FileRequest) {
  seq += 1;
  fileRequest.set({ kind, seq });
}
